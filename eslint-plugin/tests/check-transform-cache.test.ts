import { dedent } from '@ls-stack/utils/dedent';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  checkTransformRule,
  clearTransformCaches,
} from '../src/rules/check-transform';
import {
  createVindurTester,
  getErrorsWithMsgFromResult,
} from './utils/createTester';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

const { valid, invalid } = createVindurTester({
  name: 'check-transform',
  rule: checkTransformRule,
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

let themeSource = '';
let themeMtime = 0;

beforeEach(() => {
  vi.clearAllMocks();
  clearTransformCaches();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.mocked(existsSync).mockImplementation((path) =>
    String(path).endsWith('/theme.ts'),
  );
  vi.mocked(readFileSync).mockImplementation((path) => {
    if (String(path).endsWith('/theme.ts')) return themeSource;
    throw new Error(`File not found: ${String(path)}`);
  });
  vi.mocked(statSync).mockImplementation(() => {
    const stats = actualFs.statSync(import.meta.filename);
    stats.mtimeMs = themeMtime;
    return stats;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const buttonSource = dedent`
  import { styled } from 'vindur';
  import { BRAND } from '@/theme';

  export const Button = styled.button\`
    color: \${BRAND};
  \`;
`;

const buttonCase = {
  code: buttonSource,
  options: [{ importAliases: { '@': '/' } }],
};

test('should pick up a changed dependency when linting again after a pause', async () => {
  themeSource = `export const BRAND = 'red';\nexport const OTHER = 1;`;
  themeMtime = 1;
  await valid(buttonCase);

  themeSource = `export const OTHER = 1;`;
  themeMtime = 2;
  vi.setSystemTime(Date.now() + 5000);

  const { result } = await invalid(buttonCase);

  expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
    "
    - messageId: 'transformError'
      msg: '"BRAND" not found in /theme.ts, export it by name, like \`export const BRAND = ...\` or \`export { BRAND }\`'
      loc: '5:12'
    "
  `);
});

test('should not check for changed files between back-to-back calls', async () => {
  themeSource = `export const BRAND = 'red';\nexport const OTHER = 1;`;
  themeMtime = 1;
  await valid(buttonCase);

  // A CLI run doesn't change files, the cached facts of the dependency are kept
  themeSource = `export const OTHER = 1;`;
  themeMtime = 2;

  await valid(buttonCase);
  expect(vi.mocked(statSync)).toHaveBeenCalledTimes(1);
});
