const PROPERTY_DECLARATION_START_REGEX = /^[A-Za-z_-][\w-]*\s*:/u;

function startsWithPropertyDeclaration(nextParts: string[]): boolean {
  const trimmedNextPart = (nextParts[0] ?? '').trimStart();

  if (
    trimmedNextPart === ''
    || trimmedNextPart.startsWith(':')
    || !PROPERTY_DECLARATION_START_REGEX.test(trimmedNextPart)
  ) {
    return false;
  }

  for (const nextPart of nextParts) {
    for (const char of nextPart) {
      if (char === ';') return true;
      if (char === '{') return false;
    }
  }

  return true;
}

export function shouldWarnAboutLikelyMissingCssInterpolationSemicolon(
  resolvedExpression: string,
  nextParts: string[],
  isLastInterpolation: boolean,
): boolean {
  if (!resolvedExpression.trimStart().startsWith('.')) {
    return false;
  }

  const trimmedNextPart = (nextParts[0] ?? '').trimStart();

  if (trimmedNextPart === '') return isLastInterpolation;

  return startsWithPropertyDeclaration(nextParts);
}
