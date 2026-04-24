const PROPERTY_DECLARATION_START_REGEX = /^[A-Za-z_-][\w-]*\s*:/u;

function startsWithPropertyDeclaration(nextPart: string): boolean {
  const trimmedNextPart = nextPart.trimStart();

  if (
    trimmedNextPart === ''
    || trimmedNextPart.startsWith(':')
    || !PROPERTY_DECLARATION_START_REGEX.test(trimmedNextPart)
  ) {
    return false;
  }

  const firstSemicolonIndex = trimmedNextPart.indexOf(';');

  if (firstSemicolonIndex === -1) return false;

  const firstBraceIndex = trimmedNextPart.indexOf('{');

  return firstBraceIndex === -1 || firstSemicolonIndex < firstBraceIndex;
}

export function shouldWarnAboutLikelyMissingCssInterpolationSemicolon(
  resolvedExpression: string,
  nextPart: string,
  isLastInterpolation: boolean,
): boolean {
  if (!resolvedExpression.trimStart().startsWith('.')) {
    return false;
  }

  const trimmedNextPart = nextPart.trimStart();

  if (trimmedNextPart === '') return isLastInterpolation;

  return startsWithPropertyDeclaration(trimmedNextPart);
}
