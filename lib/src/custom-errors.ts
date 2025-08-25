import type { types as t } from '@babel/core';

export class TransformError extends Error {
  loc: { column: number; line: number; filename?: string } | undefined;

  constructor(message: string, loc: t.SourceLocation, filename?: string) {
    super(message);
    this.name = 'TransformError';
    this.loc = {
      column: loc.start.column,
      line: loc.start.line,
      filename: filename ?? loc.filename,
    };
  }
}
