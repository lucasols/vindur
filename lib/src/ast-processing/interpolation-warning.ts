const PROPERTY_DECLARATION_START_REGEX = /^[A-Za-z_-][\w-]*\s*:/u;

function getFirstMeaningfulNextPart(nextParts: string[]): string {
  for (const nextPart of nextParts) {
    const trimmedNextPart = nextPart.trimStart();
    if (trimmedNextPart !== '') return trimmedNextPart;
  }

  return '';
}

function startsWithPropertyDeclaration(nextParts: string[]): boolean {
  const trimmedNextPart = getFirstMeaningfulNextPart(nextParts);

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

  const trimmedNextPart = getFirstMeaningfulNextPart(nextParts);

  if (trimmedNextPart === '') return isLastInterpolation;

  return startsWithPropertyDeclaration(nextParts);
}
