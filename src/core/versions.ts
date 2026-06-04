/**
 * core/versions.ts
 * ----------------
 * Helpers for the unified `versions: [{category, quality}]` shape used by
 * every media type's scan output.
 *
 *   - `dedupVersions` — collapse duplicate (category, quality) pairs that
 *     accumulate when the same record is scanned across multiple categories
 *     or when multiple files share the same quality within a category.
 *   - `sortVersions` — sort by configured category order first (so output
 *     reflects the user's `categories:` list ordering), then by quality
 *     alphabetically. Nulls sort last so a populated quality comes before
 *     a missing one.
 *   - `finalizeVersions` — dedup then sort, the combined form used by
 *     every media module's serialize().
 */

import { Version } from './types'

/**
 * Collapse duplicate (category, quality) pairs while preserving insertion
 * order of the first occurrence. Two versions are duplicates iff both fields
 * match exactly (null === null counts as a match for quality).
 */
export function dedupVersions(versions: Version[]): Version[] {
  const seen = new Set<string>()
  const out: Version[] = []
  for (const v of versions) {
    const key = `${v.category}|${v.quality ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/**
 * Sort versions by configured category order first, then by quality.
 * Categories not in the order list sort to the end (preserves their order
 * via stable sort). Null qualities sort after populated ones within a
 * category, so a still-unprobed file doesn't appear ahead of a probed peer.
 */
export function sortVersions(versions: Version[], categoryOrder: string[]): Version[] {
  const catIndex = (c: string) => {
    const i = categoryOrder.indexOf(c)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return versions.slice().sort((a, b) => {
    const ci = catIndex(a.category) - catIndex(b.category)
    if (ci !== 0) return ci
    if (a.quality === null && b.quality === null) return 0
    if (a.quality === null) return 1
    if (b.quality === null) return -1
    return a.quality.localeCompare(b.quality)
  })
}

/** Convenience: dedup then sort. The standard finalization step on serialize. */
export function finalizeVersions(versions: Version[], categoryOrder: string[]): Version[] {
  return sortVersions(dedupVersions(versions), categoryOrder)
}

/** Distinct category names present in a versions list, in insertion order. */
export function distinctCategories(versions: Version[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of versions) {
    if (seen.has(v.category)) continue
    seen.add(v.category)
    out.push(v.category)
  }
  return out
}
