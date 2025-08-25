import type { types as t } from '@babel/core';

export class TransformError extends Error {
  loc: { column: number; line: number; filename?: string } | undefined;

  constructor(message: string, loc: t.SourceLocation | null | undefined) {
    super(message);
    this.name = 'TransformError';
    if (loc) {
      this.loc = {
        column: loc.start.column,
        line: loc.start.line,
        filename: loc.filename,
      };
    }
  }

  toString() {
    return `[TransformError: ${this.message}]`;
  }
}
