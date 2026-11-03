import { SourceMapGenerator } from 'source-map';
import type { RawSourceMap } from 'source-map';

const LEADING_WHITESPACE = /^\s/u;
const utf8Decoder = new TextDecoder();

export function createCssSourceMapFromOffsets({
  css,
  filePath,
  source,
  sourceOffsets,
}: {
  css: string;
  filePath: string;
  source: string;
  sourceOffsets: number[];
}): RawSourceMap | null {
  if (!css || sourceOffsets.length === 0) return null;

  const generator = new SourceMapGenerator({
    file: `${filePath.split('/').pop()}.css`,
    skipValidation: true,
  });
  generator.setSourceContent(filePath, source);
  const sourceBytes = new TextEncoder().encode(source);
  const lineStarts = getUtf8LineStarts(sourceBytes);
  const generatedLines = css
    .split('\n')
    .flatMap((line, index) =>
      line.length > 0 && !LEADING_WHITESPACE.test(line) && line !== '}' ?
        [index]
      : [],
    );

  for (const [index, offset] of sourceOffsets.entries()) {
    const generatedLine = generatedLines[index];
    if (generatedLine === undefined) break;
    const lineIndex = findLineIndex(lineStarts, offset);
    // Offsets are UTF-8 byte offsets, columns are UTF-16 code units like JS strings
    const linePrefix = utf8Decoder.decode(
      sourceBytes.subarray(lineStarts[lineIndex] ?? 0, offset),
    );
    generator.addMapping({
      generated: { line: generatedLine + 1, column: 0 },
      original: { line: lineIndex + 1, column: linePrefix.length },
      source: filePath,
    });
  }

  return generator.toJSON();
}

const NEWLINE_BYTE = 10;

// A newline byte is never part of a multi-byte UTF-8 sequence
function getUtf8LineStarts(bytes: Uint8Array): number[] {
  const lineStarts = [0];
  for (const [index, byte] of bytes.entries()) {
    if (byte === NEWLINE_BYTE) lineStarts.push(index + 1);
  }
  return lineStarts;
}

function findLineIndex(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}
