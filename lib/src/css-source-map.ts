import { SourceMapGenerator } from 'source-map';
import type { RawSourceMap } from 'source-map';

const LEADING_WHITESPACE = /^\s/u;

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
    const prefix = source.slice(0, offset);
    const lastNewline = prefix.lastIndexOf('\n');
    const originalLine = prefix.split('\n').length;
    const originalColumn = offset - lastNewline - 1;
    generator.addMapping({
      generated: { line: generatedLine + 1, column: 0 },
      original: { line: originalLine, column: originalColumn },
      source: filePath,
    });
  }

  return generator.toJSON();
}
