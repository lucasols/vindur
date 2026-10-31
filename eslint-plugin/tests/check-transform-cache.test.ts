import { dedent } from '@ls-stack/utils/dedent';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  checkTransformRule,
  clearTransformCaches,
} from '../src/rules/check-transform';
import { createVindurTester } from './utils/createTester';

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

type VirtualFile = { source: string; mtime: number };

// ESLint ignores files outside of its working directory
const root = process.cwd();
const themePath = `${root}/theme.ts`;

let files = new Map<string, VirtualFile>();

function writeFile(path: string, source: string) {
  files.set(path, { source, mtime: (files.get(path)?.mtime ?? 0) + 1 });
}

function advanceTime(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
  vi.clearAllMocks();
  clearTransformCaches();
  vi.useFakeTimers({ toFake: ['Date'] });
  files = new Map();
  vi.mocked(existsSync).mockImplementation((path) => files.has(String(path)));
  vi.mocked(readFileSync).mockImplementation((path) => {
    const file = files.get(String(path));
    if (!file) throw new Error(`File not found: ${String(path)}`);
    return file.source;
  });
  vi.mocked(statSync).mockImplementation((path) => {
    const stats = actualFs.statSync(import.meta.filename);
    stats.mtimeMs = files.get(String(path))?.mtime ?? -1;
    return stats;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const aliases = [{ importAliases: { '@': root } }];

const buttonCase = {
  code: dedent`
    import { styled } from 'vindur';
    import { BRAND } from '@/theme';

    export const Button = styled.button\`
      color: \${BRAND};
    \`;
  `,
  filename: `${root}/Button.tsx`,
  options: aliases,
};

const BRAND_NOT_FOUND = `"BRAND" not found in ${themePath}, export it by name, like \`export const BRAND = ...\` or \`export { BRAND }\``;

test('should pick up a changed dependency when linting again after a pause', async () => {
  writeFile(themePath, `export const BRAND = 'red';\nexport const OTHER = 1;`);
  await valid(buttonCase);

  writeFile(themePath, `export const OTHER = 1;`);
  advanceTime(5000);

  const { result } = await invalid(buttonCase);

  expect(result.messages.map((message) => message.message)).toEqual([
    BRAND_NOT_FOUND,
  ]);
});

test('should keep compiled dependencies between back-to-back calls', async () => {
  writeFile(themePath, `export const BRAND = 'red';\nexport const OTHER = 1;`);
  await valid(buttonCase);

  // A CLI run doesn't change files, the dependency isn't read again
  writeFile(themePath, `export const OTHER = 1;`);
  await valid(buttonCase);

  expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(1);
});

test('should check for changes while lint calls keep coming', async () => {
  writeFile(themePath, `export const BRAND = 'red';\nexport const OTHER = 1;`);
  await valid(buttonCase);

  writeFile(themePath, `export const OTHER = 1;`);
  advanceTime(600);
  await valid(buttonCase);

  // A second since the last check, though the previous call was 600ms ago
  advanceTime(600);
  const { result } = await invalid(buttonCase);

  expect(result.messages.map((message) => message.message)).toEqual([
    BRAND_NOT_FOUND,
  ]);
});

test('should pick up a changed file that was only linted before', async () => {
  const themeSource = dedent`
    import { css } from 'vindur';

    export const BRAND = 'red';
    export const box = css\`color: red;\`;
  `;
  writeFile(themePath, themeSource);
  await valid({ code: themeSource, filename: themePath, options: aliases });
  await valid(buttonCase);

  writeFile(
    themePath,
    dedent`
      import { css } from 'vindur';

      export const box = css\`color: red;\`;
    `,
  );
  advanceTime(5000);

  const { result } = await invalid(buttonCase);

  expect(result.messages.map((message) => message.message)).toEqual([
    BRAND_NOT_FOUND,
  ]);
});

test('should reset the cache when a missing imported file is created', async () => {
  writeFile(
    `${root}/mixins.ts`,
    `import { BASE } from './colors';\nexport const ACCENT = BASE;`,
  );
  const cardCase = {
    code: dedent`
      import { styled } from 'vindur';
      import { ACCENT } from '@/mixins';

      export const Card = styled.div\`
        color: \${ACCENT};
      \`;
    `,
    filename: `${root}/Card.tsx`,
    options: aliases,
  };
  await invalid(cardCase);

  writeFile(`${root}/colors.ts`, `export const BASE = 'red';`);
  advanceTime(5000);

  await valid(cardCase);
  expect(vi.mocked(existsSync)).toHaveBeenCalledWith(`${root}/colors.ts`);
});
