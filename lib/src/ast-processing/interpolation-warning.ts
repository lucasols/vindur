import { types as t } from '@babel/core';
import type { CssProcessingContext } from '../css-processing';
import { getOrExtractFileData } from './file-processing';

const PROPERTY_DECLARATION_START_REGEX = /^[A-Za-z_-][\w-]*\s*:/u;

function isCssInterpolationIdentifier(
  expression: t.Expression,
  context: CssProcessingContext,
): boolean {
  if (!t.isIdentifier(expression)) return false;

  if (context.state.cssVariables.has(expression.name)) {
    return true;
  }

  const cssFilePath = context.importedFunctions.get(expression.name);

  if (!cssFilePath) return false;

  const extractedData = getOrExtractFileData(cssFilePath, context);

  return extractedData.cssVariables.has(expression.name);
}

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
  expression: t.Expression,
  context: CssProcessingContext,
  nextPart: string,
  isLastInterpolation: boolean,
): boolean {
  if (!isCssInterpolationIdentifier(expression, context)) {
    return false;
  }

  const trimmedNextPart = nextPart.trimStart();

  if (trimmedNextPart === '') return isLastInterpolation;

  return startsWithPropertyDeclaration(trimmedNextPart);
}
