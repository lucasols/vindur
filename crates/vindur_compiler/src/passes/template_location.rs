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

// The evaluated quasi text can differ from the source (escapes are cooked and
// CRLF is normalized), so offsets are mapped by cooking the raw text. When that
// doesn't give the evaluated text, the matched text is looked up in the original
// source, falling back to the whole quasi when it is ambiguous
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
    let raw_quasi = source.get(span.start as usize..span.end as usize);
    if let Some(raw_quasi) = raw_quasi
        && evaluated != raw_quasi
        && let Some(offsets) = cooked_offsets(raw_quasi, evaluated)
        && let (Some(&start), Some(&end)) = (offsets.get(local.start), offsets.get(local.end))
        && let (Ok(start), Ok(end)) = (u32::try_from(start), u32::try_from(end))
    {
        return Span::new(span.start + start, span.start + end);
    }
    let raw_start = raw_quasi
        .and_then(|raw| {
            if evaluated == raw {
                return Some(local.start);
            }
            let matched = &evaluated[local.clone()];
            if evaluated.matches(matched).count() != raw.matches(matched).count() {
                return None;
            }
            let occurrence = evaluated[..local.start].matches(matched).count();
            raw.match_indices(matched)
                .nth(occurrence)
                .map(|(index, _)| index)
        })
        .and_then(|raw_start| u32::try_from(raw_start).ok());
    let len = u32::try_from(local.len()).ok();
    match (raw_start, len) {
        (Some(raw_start), Some(len)) => {
            Span::new(span.start + raw_start, span.start + raw_start + len)
        }
        _ => span,
    }
}

/// The raw offset of each byte of the evaluated quasi, plus the raw end. JS templates cook escapes
/// like `\\` and evaluate `\r\n` and `\r` to `\n`. `None` when cooking the raw text doesn't give
/// the evaluated text
fn cooked_offsets(raw: &str, evaluated: &str) -> Option<Vec<usize>> {
    let mut cooked = String::with_capacity(raw.len());
    let mut offsets = Vec::with_capacity(raw.len() + 1);
    let mut index = 0;
    while let Some(character) = raw[index..].chars().next() {
        let start = index;
        index += character.len_utf8();
        let cooked_character = match character {
            '\\' => {
                let escaped = raw[index..].chars().next()?;
                index += escaped.len_utf8();
                cooked_escape(raw, &mut index, escaped)?
            }
            '\r' => {
                if raw[index..].starts_with('\n') {
                    index += 1;
                }
                Some('\n')
            }
            character => Some(character),
        };
        if let Some(cooked_character) = cooked_character {
            offsets.extend(std::iter::repeat_n(start, cooked_character.len_utf8()));
            cooked.push(cooked_character);
        }
    }
    offsets.push(raw.len());
    (cooked == evaluated).then_some(offsets)
}

/// The character a JS template escape evaluates to, `Some(None)` for a line continuation
fn cooked_escape(raw: &str, index: &mut usize, escaped: char) -> Option<Option<char>> {
    Some(match escaped {
        'n' => Some('\n'),
        't' => Some('\t'),
        'r' => Some('\r'),
        'b' => Some('\u{8}'),
        'f' => Some('\u{c}'),
        'v' => Some('\u{b}'),
        '0' => Some('\0'),
        'x' => Some(hex_char(raw, index, 0, 2)?),
        'u' if raw[*index..].starts_with('{') => {
            let close = raw[*index..].find('}')?;
            Some(hex_char(raw, index, 1, close.checked_sub(1)?)?).inspect(|_| *index += 1)
        }
        'u' => Some(hex_char(raw, index, 0, 4)?),
        '\r' => {
            if raw[*index..].starts_with('\n') {
                *index += 1;
            }
            None
        }
        '\n' | '\u{2028}' | '\u{2029}' => None,
        escaped => Some(escaped),
    })
}

/// Reads `len` hex digits `skip` bytes after `index` and moves `index` past them
fn hex_char(raw: &str, index: &mut usize, skip: usize, len: usize) -> Option<char> {
    let start = *index + skip;
    let digits = raw.get(start..start + len)?;
    *index = start + len;
    char::from_u32(u32::from_str_radix(digits, 16).ok()?)
}

#[cfg(test)]
mod tests {
    use oxc_span::Span;

    use super::{SegmentOrigin, TemplateSegment, segment_source_span};

    #[test]
    fn maps_locations_through_template_escapes() {
        let source = r#"content: "\u003aglobal"; :global(.a) & {} content: ":global";"#;
        let css = r#"content: ":global"; :global(.a) & {} content: ":global";"#;
        let quasi_span = Span::new(0, u32::try_from(source.len()).unwrap_or(0));
        let segment = TemplateSegment {
            range: 0..css.len(),
            origin: SegmentOrigin::Quasi(quasi_span),
        };
        let start = css.find(":global(").unwrap_or(0);
        let source_start = u32::try_from(source.find(":global(").unwrap_or(0)).unwrap_or(0);
        assert_eq!(
            segment_source_span(css, source, &segment, start..start + 7),
            Span::new(source_start, source_start + 7)
        );
    }

    #[test]
    fn falls_back_to_the_quasi_when_escapes_make_the_location_ambiguous() {
        // The evaluated text is not the cooked source, so the occurrence can't be told apart
        let source = r#"content: "\u003aglobal"; :global(.a) & {} content: ":global";"#;
        let css = r#"content: ":global"; :global(.a) & {}  content: ":global";"#;
        let quasi_span = Span::new(0, u32::try_from(source.len()).unwrap_or(0));
        let segment = TemplateSegment {
            range: 0..css.len(),
            origin: SegmentOrigin::Quasi(quasi_span),
        };
        let start = css.find(":global(").unwrap_or(0);
        assert_eq!(
            segment_source_span(css, source, &segment, start..start + 7),
            quasi_span
        );
    }
}
