/**
 * core/runner-shared.ts
 * ---------------------
 * Boilerplate shared by all three runner entry points (scan, probe, validate).
 *
 * Each runner parses the same `--all | --type <value> | --help` argument
 * shape, writes JSON output the same way, and writes warnings the same way.
 * Keeping that logic in one place means a behavior change (e.g. adding a new
 * --quiet flag) ripples to all three without copy-paste.
 */

import fs from 'fs'
import path from 'path'

import { WarningCollector, WarningsOutput } from './types'

// ─────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────

/**
 * The result of parsing a runner's argv. Callers switch on `mode` to
 * dispatch — they decide whether `help` should exit cleanly or with
 * status 1 (scan.ts uses 1; help-on-no-args is conventionally an error
 * for CLI scripts, but `--help` explicitly is clean).
 */
export type RunnerMode =
  | { kind: 'all' }
  | { kind: 'one'; type: string }
  | { kind: 'help'; explicit: boolean }

/**
 * Parse `process.argv` for the runner's common flag shape.
 *
 * Exits the process with a clear error message when an invalid flag or
 * unknown `--type` value is passed. Returns a `RunnerMode` for valid input.
 *
 * `explicit` on the help mode is `true` when the user passed `--help`/`-h`
 * and `false` when they passed nothing — callers usually distinguish those
 * to set the exit status.
 */
export function parseRunnerArgs(validTypes: readonly string[]): RunnerMode {
  const args = process.argv.slice(2)
  const flag = args[0]
  const value = args[1]

  if (!flag) return { kind: 'help', explicit: false }

  if (flag === '--all') return { kind: 'all' }
  if (flag === '--help' || flag === '-h') return { kind: 'help', explicit: true }

  if (flag === '--type') {
    if (!value || !validTypes.includes(value)) {
      console.error(`\n  Error: invalid type '${value ?? ''}'. Choices: ${validTypes.join(', ')}`)
      process.exit(1)
    }
    return { kind: 'one', type: value }
  }

  console.error(`\n  Error: unknown flag '${flag}'`)
  process.exit(1)
}

// ─────────────────────────────────────────────
// Output writers
// ─────────────────────────────────────────────

/**
 * Write an arbitrary serializable object to disk as pretty-printed JSON.
 * Used by the probe and validate runners — the scan runner has its own
 * variant in `core/scanner.ts` that goes through the media module's
 * type-aware serializer first.
 *
 * Logs the file path and an item count for arrays. Creates the parent
 * directory if it doesn't already exist.
 */
export function writeJsonOutput(outputPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')
  const count = Array.isArray(data) ? data.length : 0
  console.log(`    [OUT] ${outputPath}  (${count} entries)`)
}

/**
 * Write a WarningCollector's contents to a warnings JSON file (shape:
 * `{ generated, count, files }`). Used by scan, probe, and validate.
 */
export function writeWarningsOutput(outputPath: string, warnings: WarningCollector): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const out: WarningsOutput = {
    generated: new Date().toISOString(),
    count: warnings.count(),
    files: warnings.all(),
  }
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), 'utf-8')
  console.log(`    [OUT] ${outputPath}  (${warnings.count()} warnings)`)
}
