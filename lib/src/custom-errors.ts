import type { types as t } from '@babel/core';

export class TransformError extends Error {
  loc: { column: number; line: number; filename?: string };
  /** errors to be ignored when using the ESLint plugin. Only errors that are redundant with TypeScript errors should be ignored. */
  ignoreInLint: boolean | undefined;

  constructor(
    message: string,
    loc: t.SourceLocation,
    options: {
      filename?: string;
      ignoreInLint?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'TransformError';
    this.loc = {
      column: loc.start.column,
      line: loc.start.line,
      filename: options.filename ?? loc.filename,
    };
    this.ignoreInLint = options.ignoreInLint;
  }
}

export class TransformWarning {
  message: string;
  loc: { column: number; line: number; filename?: string };
  ignoreInLint: boolean | undefined;

  constructor(
    message: string,
    loc: t.SourceLocation,
    options: {
      filename?: string;
      ignoreInLint?: boolean;
    } = {},
  ) {
    this.message = message;
    this.loc = {
      column: loc.start.column,
      line: loc.start.line,
      filename: options.filename ?? loc.filename,
    };
    this.ignoreInLint = options.ignoreInLint;
  }

  toJSON() {
    const result: Record<string, unknown> = {
      message: this.message,
      loc: `${this.loc.filename ?? 'current_file'}:${this.loc.line}:${this.loc.column}`,
    };
    if (this.ignoreInLint) {
      result.ignoreInLint = this.ignoreInLint;
    }
    return result;
  }
}
