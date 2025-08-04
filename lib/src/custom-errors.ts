type SourceLocation = {
  start: {
    column: number;
    line: number;
  };
  end: {
    column: number;
    line: number;
  };
  filename: string;
};

export class TransformError extends Error {
  loc: { column: number; line: number; filename?: string } | undefined;

  constructor(message: string, loc: SourceLocation | null | undefined) {
    super(message);
    if (loc) {
      this.loc = {
        column: loc.start.column,
        line: loc.start.line,
        filename: loc.filename,
      };
    }
  }
}
