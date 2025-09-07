import { expect } from 'vitest';
import { TransformError } from '../src/transform';

expect.addSnapshotSerializer({
  serialize(val: TransformError, config, indentation, depth, refs, printer) {
    // `printer` is a function that serializes a value using existing plugins.
    return `[TransformError: ${val.message}\nloc: ${printer(val.loc, config, indentation, depth, refs)}${val.ignoreInLint ? '\nignoreInLint: true' : ''}]`;
  },
  test(val) {
    return val instanceof TransformError;
  },
});
