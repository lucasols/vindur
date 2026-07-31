export declare class Compiler {
  constructor()
  transform(filePath: string, source: string, options?: TransformOptions | undefined | null, readFile?: ((arg: string) => string) | undefined | null, exists?: ((arg: string) => boolean) | undefined | null): TransformOutput
  invalidate(filePath: string): void
  clear(): void
}

export interface Diagnostic {
  message: string
  filePath: string
  severity: DiagnosticSeverity
  ignoreInLint: boolean
  start: SourcePosition
  end: SourcePosition
}

export declare const enum DiagnosticSeverity {
  Error = 'Error',
  Warning = 'Warning'
}

export interface SourcePosition {
  line: number
  column: number
  offset: number
}

export interface TransformOptions {
  dev?: boolean
  sourcemap?: boolean
  normalizeCode?: boolean
  importAliases?: Record<string, string>
}

export interface TransformOutput {
  code: string
  css: string
  styleDependencies: Array<string>
  diagnostics: Array<Diagnostic>
  cssSourceOffsets: Array<number>
}
