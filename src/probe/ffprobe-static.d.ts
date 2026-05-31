/**
 * Ambient type declarations for ffprobe-static.
 * The package ships no types of its own; the runtime shape is:
 *   { path: string, version: string }
 * We only consume `path` — the absolute filesystem path to the bundled
 * ffprobe binary for the current platform.
 */
declare module 'ffprobe-static' {
  const value: { path: string; version: string }
  export default value
}
