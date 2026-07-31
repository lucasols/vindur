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

const compilers = new WeakMap<TransformFunctionCache, CompilerInstance>();

export function invalidateRustTransformCache(
  transformFunctionCache: TransformFunctionCache,
  filePath: string,
): void {
  compilers.get(transformFunctionCache)?.invalidate(filePath);
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
  let compiler = compilers.get(transformFunctionCache);
  if (!compiler) {
    compiler = new Compiler();
    compilers.set(transformFunctionCache, compiler);
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
    const isMissingImportDiagnostic = diagnostic.message.startsWith('Function "');
    const isInvalidFunctionDiagnostic = diagnostic.message.startsWith(
      'called a invalid vindur function',
    );
    if (diagnostic.message.startsWith('File not found:')) {
      throw new Error(`${fileAbsPath}: ${diagnostic.message}`);
    }
    const dependencyPrefix = isDependencyDiagnostic
      && !isMissingImportDiagnostic
      && !isInvalidFunctionDiagnostic ?
        `${diagnosticFile}: `
      : '';
    const shouldAttachDependencyLocation = (isDependencyDiagnostic
      && isMissingImportDiagnostic)
      || (isDependencyDiagnostic && isInvalidFunctionDiagnostic)
      || (isDependencyDiagnostic
        && diagnostic.message.includes('= vindurFn('))
      || diagnostic.message.startsWith('vindurFn "');
    const shouldAttachRootLocation = diagnostic.message.startsWith(
      'Forward reference to undefined styled component:',
    );

    if (isMissingImportDiagnostic) {
      location.start.line = Math.max(1, location.start.line - 1);
      location.start.column = 6;
    }

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
  };
}
