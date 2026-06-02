/**
 * validate/secrets.ts
 * -------------------
 * Loader for `.secrets.json` at the project root. Holds API keys and other
 * sensitive values that must never be committed.
 *
 * The file is validated with Zod at boot, so a missing or malformed entry
 * fails with a clear, actionable message before any TMDB requests fire.
 */

import fs from 'fs'
import path from 'path'

import { z } from 'zod'

// ─────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────

/**
 * `.secrets.json` shape.
 * Extend this schema whenever a new external integration needs credentials.
 */
export const SecretsSchema = z.object({
  /** Optional documentation block — ignored by the loader. */
  _notes: z.record(z.string(), z.unknown()).optional(),
  /** The Movie Database. https://www.themoviedb.org/settings/api */
  tmdb: z.object({
    /** v3 API key. NOT the v4 bearer token. */
    api_key: z
      .string()
      .min(20, 'api_key looks too short — paste the full TMDB v3 key')
      // Reject the placeholder string from .secrets.json.example so users
      // can't accidentally try to run with the unedited template.
      .refine(s => !s.includes('PASTE-YOUR'), {
        message:
          'api_key is still the .secrets.json.example placeholder — paste your real TMDB API key',
      }),
  }),
})

export type Secrets = z.infer<typeof SecretsSchema>

// ─────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────

/**
 * Load and validate `.secrets.json`.
 *
 * On any failure (missing file, invalid JSON, schema mismatch) print a
 * targeted message that tells the user how to fix it and exit. This is
 * the only place where missing credentials should produce errors — every
 * downstream caller assumes they got valid secrets.
 */
export function loadSecrets(projectRoot: string): Secrets {
  const secretsPath = path.join(projectRoot, '.secrets.json')
  const examplePath = path.join(projectRoot, '.secrets.json.example')

  if (!fs.existsSync(secretsPath)) {
    console.error('\n  Error: .secrets.json not found at project root.')
    console.error(`    Expected at: ${secretsPath}`)
    console.error('  ')
    console.error(
      `    Copy ${path.basename(examplePath)} to .secrets.json and fill in your TMDB API key.`
    )
    console.error('    Get a free key at: https://www.themoviedb.org/settings/api')
    process.exit(1)
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'))
  } catch (err) {
    console.error(`\n  Error parsing .secrets.json: ${(err as Error).message}`)
    process.exit(1)
  }

  const parsed = SecretsSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('\n  Error: .secrets.json failed schema validation:')
    for (const issue of parsed.error.issues) {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      console.error(`    - ${where}: ${issue.message}`)
    }
    process.exit(1)
  }

  return parsed.data
}
