export function isExtensionResult(
  result: string | { type: 'extension'; className: string },
): result is { type: 'extension'; className: string } {
  return typeof result === 'object' && 'type' in result;
}