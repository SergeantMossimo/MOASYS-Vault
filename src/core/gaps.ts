/**
 * core/gaps.ts
 * ------------
 * Generic numeric gap detection. Used by shows (episodes),
 * music (tracks), and audiobooks (chapters) to surface missing
 * items inside an otherwise sequential set.
 */

/**
 * Return the integers missing between the min and max of `numbers`.
 * Example: [1, 2, 4] -> [3]
 * Returns [] for an empty input.
 */
export function findNumericGaps(numbers: number[]): number[] {
  if (numbers.length === 0) return []
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  const present = new Set(numbers)
  const gaps: number[] = []
  for (let i = min; i <= max; i++) {
    if (!present.has(i)) gaps.push(i)
  }
  return gaps
}
