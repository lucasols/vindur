export function isValidComparisonOperator(
  operator: string,
): operator is '===' | '!==' | '>' | '<' | '>=' | '<=' {
  return ['===', '!==', '>', '<', '>=', '<='].includes(operator);
}