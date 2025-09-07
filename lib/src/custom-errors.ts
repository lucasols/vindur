import type { types as t } from '@babel/core';

export class TransformError extends Error {
  loc: { column: number; line: number; filename?: string } | undefined;
  ignoreInLint?: boolean;

  constructor(
    message: string,
    loc: t.SourceLocation,
    filename?: string,
    ignoreInLint?: boolean,
  ) {
    super(message);
    this.name = 'TransformError';
    this.loc = {
      column: loc.start.column,
      line: loc.start.line,
      filename: filename ?? loc.filename,
    };
    this.ignoreInLint = ignoreInLint;
  }
}

export class TransformWarning {
  message: string;
  loc: { column: number; line: number; filename?: string };
  ignoreInLint?: boolean;

  constructor(
    message: string,
    loc: t.SourceLocation,
    filename?: string,
    ignoreInLint?: boolean,
  ) {
    this.message = message;
    this.loc = {
      column: loc.start.column,
      line: loc.start.line,
      filename: filename ?? loc.filename,
    };
    this.ignoreInLint = ignoreInLint;
  }
}
