use oxc_span::Span;

use crate::CompilerDiagnostic;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Edit {
    pub span: Span,
    pub replacement: String,
}

pub(crate) fn expand_removal_to_line(source: &str, span: Span) -> Span {
    let start = span.start as usize;
    let end = span.end as usize;
    let line_start = source[..start].rfind('\n').map_or(0, |index| index + 1);
    let line_end = source[end..]
        .find('\n')
        .map_or(source.len(), |index| end + index);

    if source[line_start..start].trim().is_empty() && source[end..line_end].trim().is_empty() {
        let expanded_end = if line_end < source.len() {
            line_end + 1
        } else {
            line_end
        };
        return Span::new(line_start as u32, expanded_end as u32);
    }

    span
}

pub(crate) fn apply_edits(
    file_path: &str,
    source: &str,
    edits: &mut [Edit],
) -> Result<String, CompilerDiagnostic> {
    edits.sort_unstable_by_key(|edit| (edit.span.start, edit.span.end));

    let mut previous_end = 0;
    for edit in edits.iter() {
        if edit.span.start < previous_end || edit.span.end < edit.span.start {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                edit.span,
                "Internal compiler error: overlapping source edits".to_owned(),
            ));
        }
        previous_end = edit.span.end;
    }

    let replacement_bytes = edits.iter().fold(0usize, |total, edit| {
        total.saturating_add(edit.replacement.len())
    });
    let removed_bytes = edits.iter().fold(0usize, |total, edit| {
        total.saturating_add((edit.span.end - edit.span.start) as usize)
    });
    let capacity = source
        .len()
        .saturating_sub(removed_bytes)
        .saturating_add(replacement_bytes);
    let mut output = String::with_capacity(capacity);
    let mut cursor = 0usize;

    for edit in edits {
        let start = edit.span.start as usize;
        let end = edit.span.end as usize;
        output.push_str(&source[cursor..start]);
        output.push_str(&edit.replacement);
        cursor = end;
    }

    output.push_str(&source[cursor..]);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use oxc_span::Span;
    use pretty_assertions::assert_eq;

    use super::{Edit, apply_edits, expand_removal_to_line};

    #[test]
    fn applies_ordered_non_overlapping_edits() {
        let mut edits = vec![
            Edit {
                span: Span::new(4, 7),
                replacement: "two".to_owned(),
            },
            Edit {
                span: Span::new(0, 3),
                replacement: "one".to_owned(),
            },
        ];

        let result = apply_edits("/test.ts", "foo bar", &mut edits).expect("valid edits");
        assert_eq!(result, "one two");
    }

    #[test]
    fn expands_a_standalone_removal_to_its_full_line() {
        let source = "const before = 1;\n  remove();  \nconst after = 2;\n";
        let start = source.find("remove").expect("fixture contains removal") as u32;
        let end = start + "remove();".len() as u32;

        assert_eq!(
            expand_removal_to_line(source, Span::new(start, end)),
            Span::new(18, 32)
        );
    }
}
