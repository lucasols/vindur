import { expect } from 'vitest';
import { TransformError } from '../src/transform';

expect.addSnapshotSerializer({
  serialize(val: TransformError) {
    // `printer` is a function that serializes a value using existing plugins.
    const base = [
      `[TransformError: ${val.message}`,
      `loc: ${getLocString(val.loc)}`,
      val.ignoreInLint ? 'ignoreInLint: true' : undefined,
    ]
      .filter(Boolean)
      .join('\n');

    return `${base}]`;
  },
  test(val) {
    return val instanceof TransformError;
  },
});

function getLocString(loc: {
  column: number;
  line: number;
  filename?: string;
}) {
  let result = loc.filename ? `${loc.filename}|` : '';
  result += `${loc.line}:${loc.column}`;
  return result;
}
