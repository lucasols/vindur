use std::ops::Range;

use oxc_span::Span;

pub(super) enum SegmentOrigin {
    Quasi(Span),
    Interpolation(Span),
}

// Maps a range of the evaluated template CSS back to the code that produced it
pub(super) struct TemplateSegment {
    pub range: Range<usize>,
    pub origin: SegmentOrigin,
}

// Maps a non empty range of the evaluated template CSS to the source code that
// produced it, along with the segment where the range starts
pub(super) fn template_source_span<'a>(
    css: &str,
    source: &str,
    segments: &'a [TemplateSegment],
    range: Range<usize>,
) -> Option<(Span, &'a TemplateSegment)> {
    let segment_at = |offset: usize| {
        segments
            .iter()
            .find(|segment| segment.range.contains(&offset))
    };
    if range.is_empty() {
        return None;
    }
    let (Some(start_segment), Some(end_segment)) =
        (segment_at(range.start), segment_at(range.end - 1))
    else {
        return None;
    };
    let first = segment_source_span(
        css,
        source,
        start_segment,
        range.start..range.end.min(start_segment.range.end),
    );
    let span = if std::ptr::eq(start_segment, end_segment) {
        first
    } else {
        let last =
            segment_source_span(css, source, end_segment, end_segment.range.start..range.end);
        Span::new(first.start, last.end)
    };
    Some((span, start_segment))
}

// The evaluated quasi text can differ from the source (`\\`, `\``, `\$` are cooked and CRLF is
// normalized, other JS escapes are rejected), so offsets are mapped by cooking the raw text,
// falling back to the whole quasi when that doesn't give the evaluated text
fn segment_source_span(
    css: &str,
    source: &str,
    segment: &TemplateSegment,
    range: Range<usize>,
) -> Span {
    let span = match segment.origin {
        SegmentOrigin::Quasi(span) => span,
        SegmentOrigin::Interpolation(span) => return span,
    };
    let evaluated = &css[segment.range.clone()];
    let local = range.start - segment.range.start..range.end - segment.range.start;
    let Some(raw_quasi) = source.get(span.start as usize..span.end as usize) else {
        return span;
    };
    let raw_range = if evaluated == raw_quasi {
        Some(local)
    } else {
        cooked_offsets(raw_quasi, evaluated).and_then(|offsets| {
            let start = *offsets.starts.get(local.start)?;
            // The raw end of the last byte
            let end = match local.end.checked_sub(1) {
                Some(last) if !local.is_empty() => *offsets.ends.get(last)?,
                _ => *offsets.starts.get(local.end)?,
            };
            Some(start..end)
        })
    };
    match raw_range.map(|range| (u32::try_from(range.start), u32::try_from(range.end))) {
        Some((Ok(start), Ok(end))) => Span::new(span.start + start, span.start + end),
        _ => span,
    }
}

/// Raw offsets of the bytes of an evaluated quasi
struct CookedOffsets {
    /// Where each byte starts, plus the raw end
    starts: Vec<usize>,
    /// Where each byte ends
    ends: Vec<usize>,
}

/// The raw offsets of each byte of the evaluated quasi. JS templates cook escapes like `\\` and
/// evaluate `\r\n` and `\r` to `\n`. `None` when cooking the raw text doesn't give the evaluated
/// text
fn cooked_offsets(raw: &str, evaluated: &str) -> Option<CookedOffsets> {
    let mut cooked = String::with_capacity(raw.len());
    let mut starts = Vec::with_capacity(raw.len() + 1);
    let mut ends = Vec::with_capacity(raw.len());
    let mut index = 0;
    while let Some(character) = raw[index..].chars().next() {
        let start = index;
        index += character.len_utf8();
        let cooked_character = match character {
            // Only escapes of the character itself reach here
            '\\' => {
                let escaped = raw[index..].chars().next()?;
                index += escaped.len_utf8();
                escaped
            }
            '\r' => {
                if raw[index..].starts_with('\n') {
                    index += 1;
                }
                '\n'
            }
            character => character,
        };
        starts.extend(std::iter::repeat_n(start, cooked_character.len_utf8()));
        ends.extend(std::iter::repeat_n(index, cooked_character.len_utf8()));
        cooked.push(cooked_character);
    }
    starts.push(raw.len());
    (cooked == evaluated).then_some(CookedOffsets { starts, ends })
}

#[cfg(test)]
mod tests {
    use oxc_span::Span;

    use super::{SegmentOrigin, TemplateSegment, segment_source_span};

    fn quasi_span(source: &str, css: &str, start: usize, end: usize) -> Span {
        let segment = TemplateSegment {
            range: 0..css.len(),
            origin: SegmentOrigin::Quasi(Span::new(0, u32::try_from(source.len()).unwrap_or(0))),
        };
        segment_source_span(css, source, &segment, start..end)
    }

    #[test]
    fn maps_locations_through_template_escapes() {
        let source = r#"content: "\\2014"; :global(.a) & {}"#;
        let css = r#"content: "\2014"; :global(.a) & {}"#;
        let start = css.find(":global(").unwrap_or(0);
        let source_start = u32::try_from(source.find(":global(").unwrap_or(0)).unwrap_or(0);
        assert_eq!(
            quasi_span(source, css, start, start + 7),
            Span::new(source_start, source_start + 7)
        );
    }

    #[test]
    fn maps_locations_of_escaped_characters() {
        let source = r"a: b\`; }";
        let css = "a: b`; }";
        let start = css.find('`').unwrap_or(0);
        assert_eq!(quasi_span(source, css, start, start + 1), Span::new(4, 6));
    }

    #[test]
    fn maps_locations_after_crlf() {
        let source = "a: b;\r\n}";
        let css = "a: b;\n}";
        let start = css.find('}').unwrap_or(0);
        assert_eq!(quasi_span(source, css, start, start + 1), Span::new(7, 8));
    }

    #[test]
    fn falls_back_to_the_quasi_when_the_evaluated_text_is_not_the_cooked_source() {
        let source = "a: b; }";
        let css = "a: b;  }";
        let start = css.find('}').unwrap_or(0);
        assert_eq!(
            quasi_span(source, css, start, start + 1),
            Span::new(0, u32::try_from(source.len()).unwrap_or(0))
        );
    }
}
