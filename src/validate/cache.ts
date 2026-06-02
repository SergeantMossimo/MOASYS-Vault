/**
 * validate/cache.ts
 * -----------------
 * JSON-backed caches for TMDB lookups. Three separate files so each cache
 * stays human-inspectable and debuggable:
 *
 *   cache/tmdb-search.json   ← search lookups   (key = "<type>|<title>|<year>")
 *   cache/tmdb-movies.json   ← movie details   (key = TMDB ID as string)
 *   cache/tmdb-shows.json    ← show details    (key = TMDB ID as string)
 *
 * Each cache shares the same load/save logic via the generic JsonCache class.
 * Schema mismatches are non-fatal — we discard and rebuild.
 *
 * Caches are write-through: callers `set()` after a successful API call,
 * then `save()` once at end of run.
 */

import fs from 'fs'
import path from 'path'

import { ValidationCacheFile } from './types'

// ─────────────────────────────────────────────
// Generic JSON cache
// ─────────────────────────────────────────────

export class JsonCache<T> {
  private entries = new Map<string, T>()

  /**
   * @param cachePath  absolute path to the JSON file on disk
   * @param version    expected schema version — mismatches discard the cache.
   *                   Default 1 keeps backward compatibility for caches that
   *                   were created before the version param existed.
   */
  constructor(
    private cachePath: string,
    private version: number = 1
  ) {
    this.load()
  }

  private load(): void {
    if (!fs.existsSync(this.cachePath)) return

    let parsed: unknown
    try {
      parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'))
    } catch (err) {
      console.log(
        `    [CACHE] Corrupt cache at ${this.cachePath} (${(err as Error).message}) — starting fresh`
      )
      return
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      !('entries' in parsed)
    ) {
      console.log(`    [CACHE] Unexpected shape at ${this.cachePath} — starting fresh`)
      return
    }

    const cf = parsed as ValidationCacheFile<T>
    if (cf.version !== this.version) {
      console.log(
        `    [CACHE] Version mismatch at ${this.cachePath} (${cf.version} vs ${this.version}) — starting fresh`
      )
      return
    }

    for (const [k, v] of Object.entries(cf.entries)) {
      this.entries.set(k, v)
    }
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true })
    // Sort keys for stable, diff-friendly output.
    const sortedEntries: Record<string, T> = {}
    for (const k of [...this.entries.keys()].sort()) {
      sortedEntries[k] = this.entries.get(k)!
    }
    const cf: ValidationCacheFile<T> = {
      version: this.version,
      entries: sortedEntries,
    }
    fs.writeFileSync(this.cachePath, JSON.stringify(cf, null, 2), 'utf-8')
  }

  get(key: string): T | undefined {
    return this.entries.get(key)
  }

  set(key: string, value: T): void {
    this.entries.set(key, value)
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  size(): number {
    return this.entries.size
  }
}

// ─────────────────────────────────────────────
// Search key helper
// ─────────────────────────────────────────────

/**
 * Build the lookup key for the search cache. Title is lowercased and trimmed
 * so case differences ("THE CROW" vs "The Crow") deduplicate. Year is part
 * of the key so a movie with the same title but a different year doesn't
 * collide.
 */
export function searchKey(type: 'movie' | 'show', title: string, year: number): string {
  return `${type}|${title.trim().toLowerCase()}|${year}`
}
