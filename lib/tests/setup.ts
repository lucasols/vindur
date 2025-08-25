import { expect } from 'vitest';
import { TransformError } from '../src/transform';

expect.addSnapshotSerializer({
  serialize(val: TransformError, config, indentation, depth, refs, printer) {
    // `printer` is a function that serializes a value using existing plugins.
    return `[\nTransformError: ${val.message}\nloc: ${printer(val.loc, config, indentation, depth, refs)}\n]`;
  },
  test(val) {
    return val instanceof TransformError;
  },
});
