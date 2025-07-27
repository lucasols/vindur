export function filterWithNarrowing<T, R>(
  array: T[],
  predicate: (value: T) => R | false,
): R[] {
  const result: R[] = [];
  for (const item of array) {
    const value = predicate(item);
    if (value !== false) {
      result.push(value);
    }
  }
  return result;
}

export function findWithNarrowing<T, R>(
  array: T[],
  predicate: (value: T) => R | false,
): R | undefined {
  for (const item of array) {
    const value = predicate(item);
    if (value !== false) return value;
  }
  return undefined;
}
