import { describe, it, expect } from 'vitest'
import type fs from 'fs'

import {
  hasExtension,
  isPrimary,
  formatPrimaryExts,
  findSuspiciousPathChars,
  findUnexpectedEntries,
} from '../../../src/core/files'

/**
 * Build a minimal fs.Dirent-shape for tests. The real type has many fields
 * and methods; we only need name, isFile, isDirectory, isSymbolicLink for
 * findUnexpectedEntries.
 */
function dirent(name: string, kind: 'file' | 'dir' | 'symlink' = 'file'): fs.Dirent {
  const isDirectory = () => kind === 'dir'
  const isFile = () => kind === 'file'
  const isSymbolicLink = () => kind === 'symlink'
  return {
    name,
    parentPath: '',
    path: '',
    isDirectory,
    isFile,
    isSymbolicLink,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as fs.Dirent
}

describe('hasExtension', () => {
  it('returns true when the extension matches', () => {
    expect(hasExtension('movie.mp4', ['.mp4'])).toBe(true)
  })

  it('returns false when the extension does not match', () => {
    expect(hasExtension('movie.mkv', ['.mp4'])).toBe(false)
  })

  it('compares case-insensitively', () => {
    expect(hasExtension('MOVIE.MP4', ['.mp4'])).toBe(true)
    expect(hasExtension('movie.mp4', ['.MP4'])).toBe(true)
  })

  it('returns false for a file with no extension', () => {
    expect(hasExtension('README', ['.txt'])).toBe(false)
  })

  it('matches when any extension in the list matches', () => {
    expect(hasExtension('movie.mkv', ['.mp4', '.mkv', '.avi'])).toBe(true)
  })

  it('returns false against an empty extension list', () => {
    expect(hasExtension('movie.mp4', [])).toBe(false)
  })
})

describe('isPrimary', () => {
  it('delegates to hasExtension', () => {
    expect(isPrimary('movie.mp4', ['.mp4'])).toBe(true)
    expect(isPrimary('movie.mkv', ['.mp4'])).toBe(false)
  })
})

describe('formatPrimaryExts', () => {
  it('formats a single extension', () => {
    expect(formatPrimaryExts(['.mp4'])).toBe('Non-.MP4')
  })

  it('joins multiple extensions with /', () => {
    expect(formatPrimaryExts(['.mp4', '.mkv'])).toBe('Non-.MP4/.MKV')
  })

  it('uppercases extensions', () => {
    expect(formatPrimaryExts(['.flac', '.mp3'])).toBe('Non-.FLAC/.MP3')
  })
})

describe('findSuspiciousPathChars', () => {
  it('returns no issues for a clean name', () => {
    expect(findSuspiciousPathChars('Pink Floyd')).toEqual([])
  })

  it('flags trailing whitespace', () => {
    expect(findSuspiciousPathChars('Pink Floyd ')).toEqual(['trailing whitespace'])
  })

  it('flags leading whitespace', () => {
    expect(findSuspiciousPathChars(' Pink Floyd')).toEqual(['leading whitespace'])
  })

  it('flags both leading and trailing whitespace', () => {
    const issues = findSuspiciousPathChars(' Pink Floyd ')
    expect(issues).toContain('leading whitespace')
    expect(issues).toContain('trailing whitespace')
  })

  it('flags trailing period', () => {
    expect(findSuspiciousPathChars('Pink Floyd.')).toEqual([
      'trailing period (Windows-incompatible)',
    ])
  })

  it('flags illegal characters', () => {
    const issues = findSuspiciousPathChars('Album: Best Hits')
    expect(issues[0]).toMatch(/illegal characters/)
    expect(issues[0]).toContain(':')
  })

  it('deduplicates and sorts illegal characters', () => {
    const issues = findSuspiciousPathChars('Why?? Album:::')
    expect(issues[0]).toBe('illegal characters: : ?')
  })

  it('flags Windows-reserved device names', () => {
    expect(findSuspiciousPathChars('CON')).toContain('Windows-reserved name')
    expect(findSuspiciousPathChars('COM1')).toContain('Windows-reserved name')
    expect(findSuspiciousPathChars('LPT9')).toContain('Windows-reserved name')
    expect(findSuspiciousPathChars('NUL.txt')).toContain('Windows-reserved name')
  })

  it('case-insensitively flags reserved names', () => {
    expect(findSuspiciousPathChars('con')).toContain('Windows-reserved name')
  })

  it('does not flag names that merely start with a reserved prefix', () => {
    expect(findSuspiciousPathChars('CONCEPT')).not.toContain('Windows-reserved name')
    expect(findSuspiciousPathChars('NULLIFY')).not.toContain('Windows-reserved name')
  })

  it('returns "empty name" for an empty string', () => {
    expect(findSuspiciousPathChars('')).toEqual(['empty name'])
  })
})

describe('findUnexpectedEntries', () => {
  const media = ['.mp4', '.mkv']
  const sidecars = ['.nfo', '.jpg', '.srt']

  it('returns unexpected entries that are neither media nor sidecar nor OS artifact', () => {
    const result = findUnexpectedEntries(
      [
        dirent('movie.mp4'),
        dirent('poster.jpg'),
        dirent('notes.txt'), // unexpected
        dirent('archive.zip'), // unexpected
      ],
      media,
      sidecars
    )
    expect(result.map(e => e.name).sort()).toEqual(['archive.zip', 'notes.txt'])
  })

  it('skips directories regardless of extension', () => {
    const result = findUnexpectedEntries(
      [dirent('Extras', 'dir'), dirent('random.txt')],
      media,
      sidecars
    )
    expect(result.map(e => e.name)).toEqual(['random.txt'])
  })

  it('skips symlinks (they are neither files nor directories per isFile)', () => {
    const result = findUnexpectedEntries(
      [dirent('link', 'symlink'), dirent('movie.mp4')],
      media,
      sidecars
    )
    expect(result).toEqual([])
  })

  it('skips known OS artifacts', () => {
    const result = findUnexpectedEntries(
      [dirent('Thumbs.db'), dirent('desktop.ini'), dirent('.DS_Store'), dirent('notes.txt')],
      media,
      sidecars
    )
    expect(result.map(e => e.name)).toEqual(['notes.txt'])
  })

  it('matches OS artifacts case-insensitively', () => {
    const result = findUnexpectedEntries([dirent('THUMBS.DB')], media, sidecars)
    expect(result).toEqual([])
  })

  it('skips hidden dotfiles entirely', () => {
    const result = findUnexpectedEntries([dirent('.hidden'), dirent('.cache.tmp')], media, sidecars)
    expect(result).toEqual([])
  })

  it('compares extensions case-insensitively', () => {
    const result = findUnexpectedEntries(
      [dirent('MOVIE.MP4'), dirent('POSTER.JPG')],
      media,
      sidecars
    )
    expect(result).toEqual([])
  })

  it('returns empty when all entries are valid', () => {
    expect(
      findUnexpectedEntries(
        [dirent('movie.mp4'), dirent('poster.jpg'), dirent('subtitle.srt')],
        media,
        sidecars
      )
    ).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(findUnexpectedEntries([], media, sidecars)).toEqual([])
  })
})
