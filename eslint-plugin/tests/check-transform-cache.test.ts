import { dedent } from '@ls-stack/utils/dedent';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  checkTransformRule,
  clearTransformCaches,
} from '../src/rules/check-transform';
import { createVindurTester } from './utils/createTester';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const { valid, invalid } = createVindurTester({
  name: 'check-transform',
  rule: checkTransformRule,
});

// ESLint ignores files outside of its working directory
const root = process.cwd();
const themePath = `${root}/theme.ts`;

let files = new Map<string, string>();

function writeFile(path: string, source: string) {
  files.set(path, source);
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
    if (file === undefined) throw new Error(`File not found: ${String(path)}`);
    return file;
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

test('should compile again at least every 30s while lint calls keep coming', async () => {
  writeFile(themePath, `export const BRAND = 'red';\nexport const OTHER = 1;`);
  await valid(buttonCase);

  writeFile(themePath, `export const OTHER = 1;`);
  advanceTime(900);
  await valid(buttonCase);

  // Calls under a second apart reuse the cache until it's 30s old
  for (let elapsed = 1800; elapsed < 30_000; elapsed += 900) {
    advanceTime(900);
    await valid(buttonCase);
  }
  advanceTime(900);

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
