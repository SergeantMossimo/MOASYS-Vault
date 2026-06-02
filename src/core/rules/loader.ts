/**
 * core/rules/loader.ts
 * --------------------
 * Generic rules loader. For a given media type:
 *   1. Start with the code-shipped defaults
 *   2. If rules/<mediaType>.yaml exists, deep-merge the user's overrides on top
 *   3. Validate the merged result with the Zod schema
 *   4. Return the typed, fully-populated rules object
 *
 * On validation failure we print a clear message and exit — there's no
 * value in scanning with broken rules.
 */

import fs from 'fs'
import path from 'path'

import jsYaml from 'js-yaml'
import { ZodError, ZodType } from 'zod'

// ─────────────────────────────────────────────
// Deep merge
// ─────────────────────────────────────────────

/**
 * True for plain `{}` objects, false for arrays, null, primitives, Maps, etc.
 * We only recursively merge objects — arrays are replaced wholesale because
 * "extend the default acceptable_quality_combos" is rarely what the user means;
 * "override the whole list" is.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && v.constructor === Object
}

/**
 * Recursively merge `override` into `base`. Object keys deep-merge; everything
 * else (arrays, primitives) replaces. Returns a new object — neither input is mutated.
 */
function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : (override as T)
  }
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(override)) {
    const baseVal = (base as Record<string, unknown>)[key]
    const overrideVal = override[key]
    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      result[key] = deepMerge(baseVal, overrideVal)
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal
    }
  }
  return result as T
}

// ─────────────────────────────────────────────
// Sentinel resolution
// ─────────────────────────────────────────────

/**
 * Replace the literal string "current" anywhere in the rules tree with the
 * current calendar year. Lets users write `max: current` in YAML without the
 * runtime code having to think about it.
 *
 * Recursive walk — works for any nesting depth, future-proofs us if other
 * rules pick up the same sentinel.
 */
function resolveSentinels<T>(value: T): T {
  if (value === 'current') return new Date().getFullYear() as unknown as T
  if (Array.isArray(value)) return value.map(resolveSentinels) as unknown as T
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveSentinels(v)
    return out as unknown as T
  }
  return value
}

// ─────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────

export interface LoadRulesOptions<T> {
  /** Logical name used in error messages and the YAML filename, e.g. "movies" */
  mediaType: string
  /** Zod schema for the rules — also the source of the inferred TypeScript type */
  schema: ZodType<T>
  /** Code-shipped defaults — used wholesale if no YAML exists */
  defaults: T
  /** Project root (where the rules/ folder lives) */
  projectRoot: string
}

/**
 * Load and validate rules for one media type.
 *
 * If rules/<mediaType>.yaml is missing, defaults are returned unchanged.
 * If it exists but is invalid YAML or fails schema validation, we exit
 * with a readable error rather than crashing later inside a media module.
 */
export function loadRules<T>(opts: LoadRulesOptions<T>): T {
  const { mediaType, schema, defaults, projectRoot } = opts
  const rulesPath = path.join(projectRoot, 'rules', `${mediaType}.yaml`)

  let merged: unknown = defaults

  if (fs.existsSync(rulesPath)) {
    let userRules: unknown
    try {
      userRules = jsYaml.load(fs.readFileSync(rulesPath, 'utf-8'))
    } catch (err) {
      console.error(`\n  Error parsing rules/${mediaType}.yaml as YAML:`)
      console.error(`    ${(err as Error).message}`)
      process.exit(1)
    }
    // A file consisting only of comments parses to null. Distinguish that
    // from a file with real overrides so users can tell at a glance whether
    // anything they wrote is taking effect.
    if (isPlainObject(userRules) && Object.keys(userRules).length > 0) {
      const overrideCount = Object.keys(userRules).length
      merged = deepMerge(defaults, userRules)
      console.log(`    [RULES] Loaded ${overrideCount} override(s) from rules/${mediaType}.yaml`)
    } else {
      console.log(
        `    [RULES] Using code defaults (rules/${mediaType}.yaml has no active overrides)`
      )
    }
  } else {
    console.log(`    [RULES] Using code defaults (no rules/${mediaType}.yaml)`)
  }

  // Resolve sentinels BEFORE validation so the schema sees their resolved form
  merged = resolveSentinels(merged)

  try {
    return schema.parse(merged)
  } catch (err) {
    if (err instanceof ZodError) {
      console.error(`\n  Error: rules/${mediaType}.yaml failed schema validation:`)
      for (const issue of err.issues) {
        const where = issue.path.length > 0 ? issue.path.join('.') : '(root)'
        console.error(`    - ${where}: ${issue.message}`)
      }
      process.exit(1)
    }
    throw err
  }
}
