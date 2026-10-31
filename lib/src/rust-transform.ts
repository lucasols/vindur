import nativeBinding, {
  type Compiler as CompilerInstance,
} from '@vindur-css/native';
import { TransformError, TransformWarning } from './custom-errors';
import type {
  TransformFunctionCache,
  TransformOptions,
  VindurTransformResult,
} from './transform';
import { mirrorRustFunctionCache } from './rust-function-cache';
import { createCssSourceMapFromOffsets } from './css-source-map';

const { Compiler } = nativeBinding;

// Keyed by mode too, the cached module facts include dev or prod class names and ids
const compilers = new WeakMap<
  TransformFunctionCache,
  Map<boolean, CompilerInstance>
>();

export function invalidateRustTransformCache(
  transformFunctionCache: TransformFunctionCache,
  filePath: string,
): void {
  const modeCompilers = compilers.get(transformFunctionCache);
  if (!modeCompilers) return;
  for (const compiler of modeCompilers.values()) {
    compiler.invalidate(filePath);
  }
}

export function transformWithRust({
  fileAbsPath,
  source,
  dev = false,
  sourcemap = false,
  debug,
  transformFunctionCache,
  fs,
  importAliases,
  onWarning,
}: TransformOptions): VindurTransformResult {
  mirrorRustFunctionCache({
    cache: transformFunctionCache,
    debug,
    filePath: fileAbsPath,
    fs,
    importAliases,
    source,
  });
  let modeCompilers = compilers.get(transformFunctionCache);
  if (!modeCompilers) {
    modeCompilers = new Map();
    compilers.set(transformFunctionCache, modeCompilers);
  }
  let compiler = modeCompilers.get(dev);
  if (!compiler) {
    compiler = new Compiler();
    modeCompilers.set(dev, compiler);
  }

  const result = compiler.transform(
    fileAbsPath,
    source,
    {
      dev,
      sourcemap,
      normalizeCode: true,
      importAliases,
    },
    fs.readFile,
    fs.exists,
  );

  for (const diagnostic of result.diagnostics) {
    const location = {
      start: {
        line: diagnostic.start.line,
        column: diagnostic.start.column,
        index: diagnostic.start.offset,
      },
      end: {
        line: diagnostic.end.line,
        column: diagnostic.end.column,
        index: diagnostic.end.offset,
      },
    };

    if (String(diagnostic.severity) === 'Warning') {
      onWarning?.(
        new TransformWarning(diagnostic.message, location, {
          filename: diagnostic.filePath || undefined,
          ignoreInLint: diagnostic.ignoreInLint,
        }),
      );
      continue;
    }

    const diagnosticFile = diagnostic.filePath || undefined;
    const isDependencyDiagnostic = diagnosticFile !== undefined
      && diagnosticFile !== fileAbsPath;
    if (diagnostic.message.startsWith('File not found:')) {
      throw new Error(`${fileAbsPath}: ${diagnostic.message}`);
    }
    const dependencyPrefix = isDependencyDiagnostic ? `${diagnosticFile}: ` : '';
    const shouldAttachDependencyLocation = isDependencyDiagnostic
      || diagnostic.message.startsWith('vindurFn "');
    const shouldAttachRootLocation = diagnostic.message.startsWith(
      'Forward reference to undefined styled component:',
    );

    throw new TransformError(
      `${fileAbsPath}: ${dependencyPrefix}${diagnostic.message}`,
      location,
      {
        filename: shouldAttachDependencyLocation || shouldAttachRootLocation ?
          (diagnosticFile ?? fileAbsPath)
        : undefined,
        ignoreInLint: diagnostic.ignoreInLint,
      },
    );
  }

  return {
    code: result.code,
    css: result.css,
    styleDependencies: result.styleDependencies,
    cssMap: sourcemap ?
      createCssSourceMapFromOffsets({
        css: result.css,
        filePath: fileAbsPath,
        source,
        sourceOffsets: result.cssSourceOffsets,
      })
    : null,
    map: null,
    changed: result.changed,
  };
}
