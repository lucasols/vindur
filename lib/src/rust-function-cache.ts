import type { CompiledFunction, FunctionArg, OutputQuasi } from './types';
import type {
  DebugLogger,
  TransformFS,
  TransformFunctionCache,
} from './transform';

type ImportedCall = {
  filePath: string;
  functionName: string;
  offset: number;
};

const IMPORT_ALIAS_SEPARATOR = /\s+as\s+/u;
const OPTIONAL_SUFFIX = /\?$/u;
const SOURCE_FILE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u;

export function mirrorRustFunctionCache({
  cache,
  debug,
  filePath,
  fs,
  importAliases,
  source,
}: {
  cache: TransformFunctionCache;
  debug: DebugLogger | undefined;
  filePath: string;
  fs: TransformFS;
  importAliases: Record<string, string>;
  source: string;
}) {
  cache[filePath] ??= {};
  const calls = importedFunctionCalls(source, filePath, fs, importAliases);
  const initializedFiles = new Set<string>();

  for (const call of calls) {
    const existingCache = cache[call.filePath];
    if (!initializedFiles.has(call.filePath) && !existingCache) {
      const fileCache = compileLegacyFunctions(fs.readFile(call.filePath));
      cache[call.filePath] = fileCache;
      initializedFiles.add(call.filePath);
      for (const name of Object.keys(fileCache)) {
        debug?.log(`[vindur:cache] Cached function "${name}" in ${call.filePath}`);
      }
      continue;
    }

    initializedFiles.add(call.filePath);
    debug?.log(
      `[vindur:cache] Cache HIT for function "${call.functionName}" in ${call.filePath}`,
    );
  }
}

function importedFunctionCalls(
  source: string,
  filePath: string,
  fs: TransformFS,
  aliases: Record<string, string>,
): ImportedCall[] {
  const calls: ImportedCall[] = [];
  const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gu;
  for (const match of source.matchAll(importPattern)) {
    const specifiers = match[1];
    const importSource = match[2];
    if (!specifiers || !importSource || importSource === 'vindur') continue;
    const resolved = resolveImport(filePath, importSource, aliases, fs);
    if (!resolved) continue;
    for (const rawSpecifier of specifiers.split(',')) {
      const parts = rawSpecifier.trim().split(IMPORT_ALIAS_SEPARATOR);
      const importedName = parts[0];
      const localName = parts[1] ?? importedName;
      if (!importedName || !localName) continue;
      const callPattern = new RegExp(`\\b${escapeRegExp(localName)}\\s*\\(`, 'gu');
      for (const call of source.matchAll(callPattern)) {
        calls.push({
          filePath: resolved,
          functionName: importedName,
          offset: call.index,
        });
      }
    }
  }
  return calls.sort((left, right) => left.offset - right.offset);
}

function compileLegacyFunctions(source: string): Record<string, CompiledFunction> {
  const functions: Record<string, CompiledFunction> = {};
  const declarationPattern = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*vindurFn\s*\(/gu;
  for (const match of source.matchAll(declarationPattern)) {
    const name = match[1];
    if (!name) continue;
    functions[name] = compileSimpleFunction(source, name) ?? {
      type: 'destructured',
      args: {},
      output: [],
    };
  }
  return functions;
}

function compileSimpleFunction(
  source: string,
  name: string,
): CompiledFunction | undefined {
  const pattern = new RegExp(
    `export\\s+const\\s+${escapeRegExp(name)}\\s*=\\s*vindurFn\\s*\\(\\s*\\(([^)]*)\\)\\s*=>\\s*\\x60([\\s\\S]*?)\\x60`,
    'u',
  );
  const match = pattern.exec(source);
  const parameterSource = match?.[1];
  const template = match?.[2];
  if (parameterSource === undefined || template === undefined) return undefined;

  const args: FunctionArg[] = parameterSource
    .split(',')
    .map((parameter) => parameter.trim())
    .filter(Boolean)
    .map((parameter) => {
      const nameWithOptional = parameter.split(':')[0]?.trim() ?? '';
      return {
        name: nameWithOptional.replace(OPTIONAL_SUFFIX, ''),
        type: 'string',
        defaultValue: undefined,
        optional: nameWithOptional.endsWith('?'),
      };
    });

  return {
    type: 'positional',
    args,
    output: compileTemplateOutput(template),
  };
}

function compileTemplateOutput(template: string): OutputQuasi[] {
  const output: OutputQuasi[] = [];
  const interpolationPattern = /\$\{([A-Za-z_$][\w$]*)\}/gu;
  let cursor = 0;
  for (const match of template.matchAll(interpolationPattern)) {
    output.push({ type: 'string', value: template.slice(cursor, match.index) });
    const name = match[1];
    if (name) output.push({ type: 'arg', name });
    cursor = match.index + match[0].length;
  }
  output.push({ type: 'string', value: template.slice(cursor) });
  return output;
}

function resolveImport(
  importer: string,
  specifier: string,
  aliases: Record<string, string>,
  fs: TransformFS,
): string | undefined {
  const alias = Object.keys(aliases)
    .filter((prefix) => specifier.startsWith(prefix))
    .sort((left, right) => right.length - left.length)[0];
  let unresolved: string;
  if (alias) {
    unresolved = `${aliases[alias]}${specifier.slice(alias.length)}`;
  } else if (specifier.startsWith('.')) {
    unresolved = normalizePath(`${importer.slice(0, importer.lastIndexOf('/'))}/${specifier}`);
  } else {
    return undefined;
  }
  const candidates = SOURCE_FILE_EXTENSION.test(unresolved) ?
      [unresolved]
    : [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        `${unresolved}.js`,
        `${unresolved}.jsx`,
      ];
  return candidates.find((candidate) => fs.exists(candidate));
}

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
