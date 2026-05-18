/**
 * core/scanner.ts
 * ---------------
 * Shared scanning scaffolding used by all media type modules.
 * Handles folder walking, warning collection, and JSON output writing.
 * Media-specific parsing is delegated to the media module passed in at runtime.
 *
 * This file should rarely need to be edited. Adding a new media type means
 * creating a new file in media/ and registering it in scan.ts — not changing this.
 */

import fs from 'fs'
import path from 'path'

import { WarningCollector, WarningsOutput, MediaModule, BaseMediaConfig } from './types'

// ─────────────────────────────────────────────
// Core scanner
// ─────────────────────────────────────────────

/**
 * Walk the media_folders defined in config and delegate per-folder
 * parsing to the media module's scanMediaFolder() function.
 *
 * Returns a Map of { unique_key -> record } where the record structure
 * is defined by the media module.
 */
export function scan<TRecord, TOutput, TConfig extends BaseMediaConfig>(
  config: TConfig,
  mediaModule: MediaModule<TRecord, TOutput, TConfig>,
  warnings: WarningCollector
): Map<string, TRecord> {
  const records = new Map<string, TRecord>()
  const { root_path, media_folders } = config

  for (const mf of media_folders) {
    const folderPath = path.join(root_path, mf.name)

    // Skip gracefully if the folder doesn't exist on this machine
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      console.log(`    [SKIP] Media folder not found: ${folderPath}`)
      continue
    }

    console.log(`    [SCAN] ${mf.name} (${mf.tag})`)

    // Ask the media module to scan this folder and return its records
    const incoming = mediaModule.scanMediaFolder(folderPath, mf.name, mf.tag, config, warnings)

    // Delegate merging to the media module — each type has its own merge logic
    mediaModule.merge(records, incoming)
  }

  // Post-merge hook: media modules can run checks that need the full records map
  mediaModule.postScan?.(records, warnings)

  return records
}

// ─────────────────────────────────────────────
// Output writers
// ─────────────────────────────────────────────

/**
 * Serialize records to a JSON file using the media module's serializer.
 * JSON.stringify with indent=2 gives readable output matching the Python version.
 */
export function writeJson<TRecord, TOutput, TConfig extends BaseMediaConfig>(
  records: Map<string, TRecord>,
  mediaModule: MediaModule<TRecord, TOutput, TConfig>,
  outputPath: string
): void {
  const data = mediaModule.serialize(records)
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')
  console.log(`    [OUT] ${outputPath}  (${data.length} entries)`)
}

/**
 * Write all collected warnings to a JSON file.
 * Timestamp is UTC ISO 8601 to match the Python version.
 */
export function writeWarnings(warnings: WarningCollector, outputPath: string): void {
  const out: WarningsOutput = {
    generated: new Date().toISOString(),
    count: warnings.count(),
    files: warnings.all(),
  }
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), 'utf-8')
  console.log(`    [OUT] ${outputPath}  (${warnings.count()} warnings)`)
}
