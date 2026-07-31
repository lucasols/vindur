const assert = require('node:assert/strict');
const test = require('node:test');
const { Compiler } = require('../index.js');

test('extracts static CSS through the Node-API boundary', () => {
  const compiler = new Compiler();
  const result = compiler.transform(
    '/test.tsx',
    "import { css } from 'vindur'; const color = 'red'; const style = css`color: ${color};`;",
    { dev: true },
  );

  assert.equal(
    result.code,
    " const color = 'red'; const style = \"v1560qbr-1-style\";",
  );
  assert.equal(result.css, '.v1560qbr-1-style {\n  color: red;\n}');
  assert.deepEqual(result.diagnostics, []);
});

