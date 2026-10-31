//! Maps the compiled code back to the source through the edit steps of a transform, to emit
//! the JS sourcemap

use crate::edit::Edit;

/// A range of the output, either copied from the source or the replacement of an edit,
/// which maps to the start of the replaced span
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Chunk {
    out_start: usize,
    out_end: usize,
    src_start: usize,
    copied: bool,
}

impl Chunk {
    fn src_at(&self, out_offset: usize) -> usize {
        if self.copied {
            self.src_start + (out_offset - self.out_start)
        } else {
            self.src_start
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct CodeMap {
    /// Sorted chunks covering the output, without gaps
    chunks: Vec<Chunk>,
}

impl CodeMap {
    /// The map of `apply_edits`, `edits` must be sorted as `apply_edits` leaves them
    pub(crate) fn from_edits(input_len: usize, edits: &[Edit]) -> Self {
        let mut chunks = Vec::with_capacity(edits.len() * 2 + 1);
        let mut out = 0usize;
        let mut cursor = 0usize;
        let mut push = |chunks: &mut Vec<Chunk>, len: usize, src_start: usize, copied: bool| {
            if len > 0 {
                chunks.push(Chunk {
                    out_start: out,
                    out_end: out + len,
                    src_start,
                    copied,
                });
                out += len;
            }
        };
        for edit in edits {
            let start = edit.span.start as usize;
            push(&mut chunks, start - cursor, cursor, true);
            push(&mut chunks, edit.replacement.len(), start, false);
            cursor = edit.span.end as usize;
        }
        push(&mut chunks, input_len - cursor, cursor, true);
        Self { chunks }
    }

    /// Maps the output of `next`, whose input is the output of `self`, to the input of `self`
    pub(crate) fn then(&self, next: &Self) -> Self {
        let mut chunks = Vec::with_capacity(self.chunks.len() + next.chunks.len());
        let mut index = 0usize;
        for next_chunk in &next.chunks {
            if !next_chunk.copied {
                let src_start = self.src_at(next_chunk.src_start, &mut index);
                chunks.push(Chunk {
                    src_start,
                    ..*next_chunk
                });
                continue;
            }
            let mid_start = next_chunk.src_start;
            let mid_end = mid_start + (next_chunk.out_end - next_chunk.out_start);
            let mut mid = mid_start;
            while mid < mid_end {
                let Some(chunk) = self.chunk_at(mid, &mut index) else {
                    break;
                };
                let end = chunk.out_end.min(mid_end);
                let out_start = next_chunk.out_start + (mid - mid_start);
                chunks.push(Chunk {
                    out_start,
                    out_end: out_start + (end - mid),
                    src_start: chunk.src_at(mid),
                    copied: chunk.copied,
                });
                mid = end;
            }
        }
        Self { chunks }
    }

    /// The chunk containing `offset`, searching forward from `index`, which keeps the
    /// position for the next increasing offset
    fn chunk_at(&self, offset: usize, index: &mut usize) -> Option<Chunk> {
        if self
            .chunks
            .get(*index)
            .is_none_or(|chunk| chunk.out_start > offset)
        {
            *index = self.chunks.partition_point(|chunk| chunk.out_end <= offset);
        }
        while let Some(chunk) = self.chunks.get(*index) {
            if offset < chunk.out_end {
                return Some(*chunk);
            }
            *index += 1;
        }
        None
    }

    fn src_at(&self, offset: usize, index: &mut usize) -> usize {
        match self.chunk_at(offset, index) {
            Some(chunk) => chunk.src_at(offset),
            // The end of the output maps to the end of the last chunk
            None => self.chunks.last().map_or(offset, |chunk| {
                chunk.src_at(chunk.out_end - usize::from(chunk.copied)) + usize::from(chunk.copied)
            }),
        }
    }

    /// The `mappings` field of a v3 sourcemap of `output`, compiled from `source`, with a
    /// segment at the start of each chunk, line and token, columns in UTF-16 code units
    pub(crate) fn mappings(&self, source: &str, output: &str) -> String {
        let source_lines = LineIndex::new(source);
        let mut encoder = MappingsEncoder::default();
        let mut chunks = self.chunks.iter().peekable();
        let mut line = 0u32;
        let mut column = 0u32;
        let mut previous: Option<char> = None;
        for (offset, character) in output.char_indices() {
            while chunks.next_if(|chunk| chunk.out_end <= offset).is_some() {}
            let Some(chunk) = chunks.peek() else {
                break;
            };
            let at_chunk_start = chunk.out_start == offset;
            let at_line_start = previous.is_none_or(|previous| previous == '\n');
            let at_token_start = chunk.copied
                && !character.is_whitespace()
                && previous.is_none_or(|previous| is_token_boundary(previous, character));
            if character != '\n' && (at_chunk_start || at_line_start || at_token_start) {
                let (src_line, src_column) = source_lines.position(source, chunk.src_at(offset));
                encoder.push(line, column, src_line, src_column);
            }
            if character == '\n' {
                line += 1;
                column = 0;
            } else {
                column += u32::try_from(character.len_utf16()).unwrap_or(1);
            }
            previous = Some(character);
        }
        encoder.finish()
    }
}

fn is_identifier_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_' || character == '$'
}

fn is_token_boundary(previous: char, character: char) -> bool {
    previous.is_whitespace() || !is_identifier_char(previous) || !is_identifier_char(character)
}

struct LineIndex {
    starts: Vec<usize>,
}

impl LineIndex {
    fn new(source: &str) -> Self {
        let mut starts = vec![0];
        starts.extend(
            source
                .bytes()
                .enumerate()
                .filter(|(_, byte)| *byte == b'\n')
                .map(|(index, _)| index + 1),
        );
        Self { starts }
    }

    fn position(&self, source: &str, offset: usize) -> (u32, u32) {
        let line = self.starts.partition_point(|start| *start <= offset) - 1;
        let line_start = self.starts[line];
        let prefix = source.get(line_start..offset).unwrap_or_default();
        let column = if prefix.is_ascii() {
            prefix.len()
        } else {
            prefix.encode_utf16().count()
        };
        (
            u32::try_from(line).unwrap_or(u32::MAX),
            u32::try_from(column).unwrap_or(u32::MAX),
        )
    }
}

#[derive(Default)]
struct MappingsEncoder {
    output: String,
    line: u32,
    previous_column: u32,
    previous_src_line: u32,
    previous_src_column: u32,
    has_segment_in_line: bool,
}

impl MappingsEncoder {
    fn push(&mut self, line: u32, column: u32, src_line: u32, src_column: u32) {
        while self.line < line {
            self.output.push(';');
            self.line += 1;
            self.previous_column = 0;
            self.has_segment_in_line = false;
        }
        if self.has_segment_in_line {
            self.output.push(',');
        }
        encode_vlq(&mut self.output, delta(column, self.previous_column));
        // The single source, always index 0
        encode_vlq(&mut self.output, 0);
        encode_vlq(&mut self.output, delta(src_line, self.previous_src_line));
        encode_vlq(
            &mut self.output,
            delta(src_column, self.previous_src_column),
        );
        self.previous_column = column;
        self.previous_src_line = src_line;
        self.previous_src_column = src_column;
        self.has_segment_in_line = true;
    }

    fn finish(self) -> String {
        self.output
    }
}

fn delta(value: u32, previous: u32) -> i64 {
    i64::from(value) - i64::from(previous)
}

const BASE64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode_vlq(output: &mut String, value: i64) {
    let mut remaining = if value < 0 {
        (value.unsigned_abs() << 1) | 1
    } else {
        value.unsigned_abs() << 1
    };
    loop {
        let mut digit = remaining & 0b1_1111;
        remaining >>= 5;
        if remaining > 0 {
            digit |= 0b10_0000;
        }
        output.push(char::from(
            BASE64_CHARS[usize::try_from(digit).unwrap_or(0)],
        ));
        if remaining == 0 {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use oxc_span::Span;
    use pretty_assertions::assert_eq;

    use super::{CodeMap, encode_vlq};
    use crate::edit::{Edit, apply_edits};

    fn edit(start: u32, end: u32, replacement: &str) -> Edit {
        Edit {
            span: Span::new(start, end),
            replacement: replacement.to_owned(),
        }
    }

    fn apply(source: &str, mut edits: Vec<Edit>) -> (String, CodeMap) {
        let code = apply_edits("/test.ts", source, &mut edits).expect("valid edits");
        let map = CodeMap::from_edits(source.len(), &edits);
        (code, map)
    }

    /// The source offset of each output offset
    fn offsets(map: &CodeMap, output: &str) -> Vec<usize> {
        let mut index = 0;
        (0..output.len())
            .map(|offset| map.src_at(offset, &mut index))
            .collect()
    }

    #[test]
    fn encodes_vlq_values() {
        let mut output = String::new();
        for value in [0, 1, -1, 15, 16, -16, 1000] {
            encode_vlq(&mut output, value);
            output.push(' ');
        }
        assert_eq!(output, "A C D e gB hB w+B ");
    }

    #[test]
    fn maps_copied_and_replaced_ranges() {
        let (code, map) = apply("ab cd ef", vec![edit(3, 5, "XYZ"), edit(0, 1, "")]);
        assert_eq!(code, "b XYZ ef");
        assert_eq!(offsets(&map, &code), [1, 2, 3, 3, 3, 5, 6, 7]);
    }

    #[test]
    fn composes_edit_steps() {
        let source = "one two three four";
        let (first, first_map) = apply(source, vec![edit(4, 7, "2")]);
        assert_eq!(first, "one 2 three four");
        let (second, second_map) = apply(&first, vec![edit(0, 4, ""), edit(11, 12, "\n")]);
        assert_eq!(second, "2 three\nfour");
        let map = first_map.then(&second_map);
        assert_eq!(
            offsets(&map, &second),
            [4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
        );
    }

    #[test]
    fn emits_segments_for_lines_and_tokens() {
        let source = "const a = 1;\n\nconst b = 2;\n";
        let (code, map) = apply(source, vec![edit(12, 14, "\n")]);
        assert_eq!(code, "const a = 1;\nconst b = 2;\n");
        assert_eq!(
            map.mappings(source, &code),
            "AAAA,MAAM,EAAE,EAAE,CAAC;AAEX,MAAM,EAAE,EAAE,CAAC"
        );
    }
}
