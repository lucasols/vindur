export type ScopedVariableMap = Map<
  string,
  { index: number; originalName: string }
>;

export type ScopedVariableResult = {
  processedCss: string;
  scopedVariables: ScopedVariableMap;
  warnings: string[];
};

export function processScopedCssVariables(
  css: string,
  scopeHash: string,
  dev: boolean,
  existingScopedVariables?: ScopedVariableMap,
  classIndexRef?: { current: number },
  potentiallyUndeclaredVariables?: Set<string>,
): ScopedVariableResult {
  const scopedVariables: ScopedVariableMap = new Map();
  const warnings: string[] = [];

  // Track declared and used variables for validation
  const declaredVariables = new Set<string>();
  const usedVariables = new Set<string>();

  // First pass: Find all scoped variable declarations (---varname: value)
  const declarationRegex = /---([a-zA-Z0-9-]+)\s*:\s*([^;]+);?/g;
  let processedCss = css.replace(
    declarationRegex,
    (_match: string, varName: string, value: string) => {
      const trimmedVarName = varName.trim();
      declaredVariables.add(trimmedVarName);

      let varInfo =
        existingScopedVariables?.get(trimmedVarName)
        || scopedVariables.get(trimmedVarName);

      if (!varInfo) {
        // Assign new index using shared counter
        if (classIndexRef) {
          classIndexRef.current++;
          varInfo = {
            index: classIndexRef.current,
            originalName: trimmedVarName,
          };
        } else {
          // Fallback for when no shared counter is provided
          const newIndex =
            Math.max(
              0,
              ...[...scopedVariables.values()].map((v) => v.index),
              ...(existingScopedVariables ?
                [...existingScopedVariables.values()].map((v) => v.index)
              : []),
            ) + 1;
          varInfo = {
            index: newIndex,
            originalName: trimmedVarName,
          };
        }
        scopedVariables.set(trimmedVarName, varInfo);
      }

      const scopedVarName =
        dev ?
          `--${scopeHash}-${varInfo.index}-${varInfo.originalName}`
        : `--${scopeHash}-${varInfo.index}`;

      return `${scopedVarName}: ${value};`;
    },
  );

  // Second pass: Replace all scoped variable usages var(---varname)
  const usageRegex = /var\(\s*---([a-zA-Z0-9-]+)\s*(?:,\s*([^)]+))?\)/g;
  processedCss = processedCss.replace(
    usageRegex,
    (_match: string, varName: string, fallback?: string) => {
      const trimmedVarName = varName.trim();
      usedVariables.add(trimmedVarName);

      let varInfo =
        existingScopedVariables?.get(trimmedVarName)
        || scopedVariables.get(trimmedVarName);

      if (!varInfo) {
        // Variable is used but not declared - we'll still transform it
        // This allows for style prop usage
        if (classIndexRef) {
          classIndexRef.current++;
          varInfo = {
            index: classIndexRef.current,
            originalName: trimmedVarName,
          };
        } else {
          // Fallback for when no shared counter is provided
          const newIndex =
            Math.max(
              0,
              ...[...scopedVariables.values()].map((v) => v.index),
              ...(existingScopedVariables ?
                [...existingScopedVariables.values()].map((v) => v.index)
              : []),
            ) + 1;
          varInfo = {
            index: newIndex,
            originalName: trimmedVarName,
          };
        }
        scopedVariables.set(trimmedVarName, varInfo);
      }

      const scopedVarName =
        dev ?
          `--${scopeHash}-${varInfo.index}-${varInfo.originalName}`
        : `--${scopeHash}-${varInfo.index}`;

      return fallback ?
          `var(${scopedVarName}, ${fallback})`
        : `var(${scopedVarName})`;
    },
  );

  // Generate warnings for declared but not used variables
  if (dev) {
    for (const declaredVar of declaredVariables) {
      if (!usedVariables.has(declaredVar)) {
        const warning = `Scoped variable '---${declaredVar}' is declared but never read`;
        warnings.push(warning);
      }
    }

    // Track variables used but never declared (may be provided via style props)
    if (potentiallyUndeclaredVariables) {
      for (const usedVar of usedVariables) {
        // Check if variable is declared in current CSS or exists in file-level scoped variables
        const isDeclaredHere = declaredVariables.has(usedVar);
        const isDeclaredInFile = existingScopedVariables?.has(usedVar);

        if (!isDeclaredHere && !isDeclaredInFile) {
          potentiallyUndeclaredVariables.add(usedVar);
        }
      }
    }
  }

  return {
    processedCss,
    scopedVariables,
    warnings,
  };
}

export function transformStylePropScopedVariables<T = unknown>(
  styleValue: Record<string, T>,
  scopedVariables: ScopedVariableMap,
  scopeHash: string,
  dev: boolean,
): { transformedStyle: Record<string, T>; warnings: string[] } {
  const transformedStyle: Record<string, T> = {};
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(styleValue)) {
    if (key.startsWith('---')) {
      // This is a scoped variable
      const varName = key.slice(3); // Remove '---' prefix
      const varInfo = scopedVariables.get(varName);

      if (!varInfo && dev) {
        const warning = `Css variable '${key}' is not used in the file`;
        warnings.push(warning);
      }

      // Transform the key even if not found in scopedVariables
      // This allows dynamic style prop usage
      const finalVarInfo = varInfo || {
        index: Array.from(scopedVariables.values()).length + 1,
        originalName: varName,
      };

      const scopedVarName =
        dev ?
          `--${scopeHash}-${finalVarInfo.index}-${finalVarInfo.originalName}`
        : `--${scopeHash}-${finalVarInfo.index}`;

      transformedStyle[scopedVarName] = value;
    } else {
      // Not a scoped variable, pass through as-is
      transformedStyle[key] = value;
    }
  }

  return { transformedStyle, warnings };
}
