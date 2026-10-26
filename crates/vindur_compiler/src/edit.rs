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

/// The source of `span` with the edits inside it applied, taking them out of `edits`, for a
/// replacement that copies source another pass already edits. Overlapping edits are left in
/// `edits` so `apply_edits` reports them
pub(crate) fn take_edited_source(source: &str, span: Span, edits: &mut Vec<Edit>) -> String {
    let (mut nested, rest): (Vec<Edit>, Vec<Edit>) = edits
        .drain(..)
        .partition(|edit| edit.span.start >= span.start && edit.span.end <= span.end);
    *edits = rest;
    nested.sort_unstable_by_key(|edit| (edit.span.start, edit.span.end));
    if nested
        .windows(2)
        .any(|pair| pair[1].span.start < pair[0].span.end)
    {
        edits.extend(nested);
        return source[span.start as usize..span.end as usize].to_owned();
    }
    let mut output = String::new();
    let mut cursor = span.start as usize;
    for edit in nested {
        output.push_str(&source[cursor..edit.span.start as usize]);
        output.push_str(&edit.replacement);
        cursor = edit.span.end as usize;
    }
    output.push_str(&source[cursor..span.end as usize]);
    output
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

    use super::{Edit, apply_edits, expand_removal_to_line, take_edited_source};

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

    #[test]
    fn takes_the_edits_inside_a_copied_span() {
        let source = "a({ x: 1 }) b";
        let mut edits = vec![
            Edit {
                span: Span::new(4, 5),
                replacement: "y".to_owned(),
            },
            Edit {
                span: Span::new(12, 13),
                replacement: "c".to_owned(),
            },
        ];

        assert_eq!(
            take_edited_source(source, Span::new(2, 10), &mut edits),
            "{ y: 1 }"
        );
        assert_eq!(
            edits,
            vec![Edit {
                span: Span::new(12, 13),
                replacement: "c".to_owned(),
            }]
        );
    }
}
