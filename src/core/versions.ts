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
 *   - `groupCategoriesByQuality` — bucket the distinct categories by quality
 *     tier, the shared basis for the movies/shows `warn_multi_quality` and
 *     `warn_duplicate_quality` postScan checks.
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

/**
 * Group the distinct categories in a versions list by the quality tier each
 * one maps to (per `buildCategoryQualityMap` in core/rules/helpers.ts).
 * Categories with no detected quality map to their own name, so a general-tag
 * library gets one single-entry bucket per tag and never looks duplicated.
 *
 * The key insight both quality checks rely on: the map's *keys* are the set of
 * distinct qualities (what `warn_multi_quality` compares against
 * `acceptable_quality_combos`), while a bucket holding more than one category
 * means the same item is stored twice at the same quality — a genuine
 * duplicate that collapsing to a Set of qualities would hide.
 *
 * Category order within each bucket follows `distinctCategories` insertion
 * order, which reflects the order the scanner walked the category folders.
 */
export function groupCategoriesByQuality(
  versions: Version[],
  categoryToQuality: Map<string, string>
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const category of distinctCategories(versions)) {
    const quality = categoryToQuality.get(category) ?? category
    const bucket = out.get(quality)
    if (bucket) bucket.push(category)
    else out.set(quality, [category])
  }
  return out
}
