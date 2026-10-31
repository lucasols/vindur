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
    // Offsets are UTF-8 byte offsets, columns are UTF-16 code units like JS strings
    const prefix = utf8Decoder.decode(sourceBytes.subarray(0, offset));
    const lastNewline = prefix.lastIndexOf('\n');
    const originalLine = prefix.split('\n').length;
    const originalColumn = prefix.length - lastNewline - 1;
    generator.addMapping({
      generated: { line: generatedLine + 1, column: 0 },
      original: { line: originalLine, column: originalColumn },
      source: filePath,
    });
  }

  return generator.toJSON();
}
