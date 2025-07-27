// Re-export all functions from the ast-processing module
export {
  processInterpolationExpression,
  processTemplateWithInterpolation,
} from './ast-processing/interpolation';

export {
  resolveVariable,
  resolveBinaryExpression,
  resolveFunctionCall,
} from './ast-processing/resolution';

export {
  resolveThemeColorExpression,
  resolveThemeColorCallExpression,
} from './ast-processing/theme-colors';

export {
  resolveDynamicColorExpression,
  resolveDynamicColorCallExpression,
} from './ast-processing/dynamic-colors';

export {
  getOrExtractFileData,
  resolveImportedConstant,
  resolveImportedThemeColors,
} from './ast-processing/file-processing';