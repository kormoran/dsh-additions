/**
 * Workspace statistics for the `dsh-additions` right-hand panel.
 *
 * One scan answers four questions about a workspace directory: how big it is,
 * how many directories and files it holds, and how many lines of code and of
 * documentation it contains. Documentation counts as code — the caller gets the
 * two figures separately and their sum.
 *
 * The scan is deliberately defensive, because a workspace is an arbitrary user
 * directory and a web request must never hang on it:
 *
 * - generated and vendored trees (`.git`, `node_modules`, `.venv`, `dist`,
 *   `build`, `target`, caches) are skipped entirely;
 * - symbolic links are not followed, so a link cycle cannot loop the walk;
 * - a wall-clock budget, an entry budget and a read-bytes budget stop the walk
 *   early, and the answer says which one fired (`truncated`, `exhausted`);
 * - lines are counted by streaming fixed-size chunks, never by loading a file,
 *   and a NUL byte in the head marks a binary file that is counted as bytes but
 *   not as lines.
 *
 * @module dsh-additions/workspace-stats
 */

import { open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Authenticated route that answers one workspace's statistics. */
export const STATS_PATH = '/api/additions.workspace-stats'
/** Milliseconds of wall time one scan may spend before it stops early. */
export const DEFAULT_TIME_LIMIT_MS = 10000
/** Minimum age of a cached scan result before it is recomputed. */
export const DEFAULT_CACHE_TTL_MS = 15000
/** Directories and files one scan may visit. */
export const DEFAULT_MAX_ENTRIES = 200000
/** Bytes one scan may read while counting lines. */
export const DEFAULT_MAX_BYTES_READ = 64 * 1024 * 1024
/** Bytes of one file the line counter may read. */
export const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024
/** Read size of the line counter. */
const CHUNK_BYTES = 64 * 1024
/** Head bytes inspected for a NUL byte when classifying a file as binary. */
const SNIFF_BYTES = 8192

/** Source-code extensions (case-insensitive). */
const CODE_EXTENSIONS = new Set([
  'astro',
  'bash',
  'bat',
  'c',
  'cc',
  'cjs',
  'clj',
  'cljs',
  'cmd',
  'cpp',
  'cs',
  'css',
  'cts',
  'cxx',
  'dart',
  'erl',
  'ex',
  'exs',
  'fs',
  'go',
  'gql',
  'graphql',
  'h',
  'hh',
  'hpp',
  'hrl',
  'hs',
  'htm',
  'html',
  'java',
  'jl',
  'js',
  'jsx',
  'kt',
  'kts',
  'less',
  'lua',
  'm',
  'mjs',
  'ml',
  'mli',
  'mm',
  'mts',
  'nim',
  'php',
  'pl',
  'proto',
  'ps1',
  'psm1',
  'py',
  'pyi',
  'r',
  'rb',
  'rs',
  'sass',
  'scala',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'tf',
  'ts',
  'tsx',
  'vue',
  'zig',
  'zsh',
])

/** Documentation and prose extensions (case-insensitive). */
const DOC_EXTENSIONS = new Set([
  'adoc',
  'asciidoc',
  'md',
  'mdx',
  'markdown',
  'org',
  'rst',
  'tex',
  'txt',
  'wiki',
])

/** Vendored, generated and cache directories that never count. */
const EXCLUDED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.gradle',
  '.hg',
  '.idea',
  '.mypy_cache',
  '.next',
  '.nuxt',
  '.output',
  '.pytest_cache',
  '.ruff_cache',
  '.svn',
  '.turbo',
  '.venv',
  '.vscode',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'venv',
])

/**
 * Normalize the `stats` bundle config.
 *
 * @param config - raw config (`timeLimitMs`, `cacheTtlMs`, `maxEntries`, `maxBytesRead`).
 * @returns the effective limits.
 */
export function normalizeStatsConfig(config) {
  const raw = config ?? {}
  return {
    timeLimitMs: readLimit(raw.timeLimitMs, DEFAULT_TIME_LIMIT_MS, 120000),
    cacheTtlMs: readLimit(raw.cacheTtlMs, DEFAULT_CACHE_TTL_MS, 600000),
    maxEntries: readLimit(raw.maxEntries, DEFAULT_MAX_ENTRIES, 2000000),
    maxBytesRead: readLimit(raw.maxBytesRead, DEFAULT_MAX_BYTES_READ, 1024 * 1024 * 1024),
  }
}

/**
 * Scan one workspace directory.
 *
 * @param root - absolute directory to scan.
 * @param options - effective limits ({@link normalizeStatsConfig} output).
 * @returns the totals plus truncation evidence.
 */
export async function scanWorkspace(root, options = {}) {
  const limits = { ...normalizeStatsConfig({}), ...options }
  const started = Date.now()
  const totals = {
    path: root,
    sizeBytes: 0,
    directories: 0,
    files: 0,
    codeFiles: 0,
    docFiles: 0,
    codeLines: 0,
    docLines: 0,
    totalLines: 0,
    truncated: false,
    exhausted: null,
    elapsedMs: 0,
  }
  const stack = [root]
  let bytesRead = 0

  while (stack.length > 0) {
    if (Date.now() - started > limits.timeLimitMs) return finish(totals, started, 'time')
    const directory = stack.pop()
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) continue
        if (totals.directories + totals.files >= limits.maxEntries) return finish(totals, started, 'entries')
        totals.directories += 1
        stack.push(join(directory, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (totals.directories + totals.files >= limits.maxEntries) return finish(totals, started, 'entries')

      const full = join(directory, entry.name)
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }
      totals.files += 1
      totals.sizeBytes += info.size

      const kind = classify(entry.name)
      if (kind === undefined) continue
      if (bytesRead >= limits.maxBytesRead) return finish(totals, started, 'bytes')

      const counted = await countLines(full, Math.min(DEFAULT_MAX_FILE_BYTES, limits.maxBytesRead - bytesRead))
      bytesRead += counted.bytes
      if (counted.binary) continue
      if (counted.truncated) {
        totals.truncated = true
        totals.exhausted = totals.exhausted ?? 'file'
      }
      if (kind === 'code') {
        totals.codeFiles += 1
        totals.codeLines += counted.lines
      } else {
        totals.docFiles += 1
        totals.docLines += counted.lines
      }
    }
  }

  return finish(totals, started, null)
}

/**
 * Close a scan result with its totals and elapsed time.
 *
 * @param totals - mutable accumulator.
 * @param started - scan start timestamp.
 * @param exhausted - `'time'`, `'entries'`, `'bytes'`, or null.
 * @returns the result.
 */
function finish(totals, started, exhausted) {
  totals.totalLines = totals.codeLines + totals.docLines
  totals.elapsedMs = Date.now() - started
  if (exhausted !== null) totals.truncated = true
  totals.exhausted = exhausted ?? totals.exhausted
  return totals
}

/**
 * @param name - file name.
 * @returns `'code'`, `'doc'`, or undefined when the file is not counted.
 */
function classify(name) {
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return undefined
  const extension = name.slice(dot + 1).toLowerCase()
  if (CODE_EXTENSIONS.has(extension)) return 'code'
  if (DOC_EXTENSIONS.has(extension)) return 'doc'
  return undefined
}

/**
 * Count the lines of one text file without loading it whole.
 *
 * A file counts as binary when its head contains a NUL byte: it contributes
 * bytes (already accounted by the caller) but no lines.
 *
 * @param path - file to read.
 * @param maxBytes - bytes this file may consume.
 * @returns `{ lines, bytes, binary, truncated }`.
 */
export async function countLines(path, maxBytes) {
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return { lines: 0, bytes: 0, binary: true, truncated: false }
  }
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES)
  let lines = 0
  let bytes = 0
  let position = 0
  let lastByte = 0
  let sniffed = false
  let binary = false
  let truncated = false
  try {
    while (position < maxBytes) {
      const wanted = Math.min(buffer.length, maxBytes - position)
      const { bytesRead } = await handle.read(buffer, 0, wanted, position)
      if (bytesRead === 0) break
      position += bytesRead
      bytes += bytesRead
      if (!sniffed) {
        sniffed = true
        const head = Math.min(bytesRead, SNIFF_BYTES)
        for (let index = 0; index < head; index += 1) {
          if (buffer[index] === 0) {
            binary = true
            break
          }
        }
        if (binary) break
      }
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] === 0x0a) lines += 1
      }
      lastByte = buffer[bytesRead - 1]
    }
    truncated = position >= maxBytes && maxBytes > 0
  } finally {
    await handle.close()
  }
  if (binary) return { lines: 0, bytes, binary: true, truncated: false }
  return { lines: bytes > 0 && lastByte !== 0x0a ? lines + 1 : lines, bytes, binary: false, truncated }
}

/**
 * Resolve the directory one statistics request names.
 *
 * @param request - `{ workspaceId }` or `{ path }`, already parsed.
 * @param deps - `{ workspaceRegistry, realpath }` seams.
 * @returns the canonical directory path.
 * @throws {import('./index.js').MoveError} for every expected refusal.
 */
export async function resolveStatsTarget(request, deps) {
  const workspaceId = typeof request.workspaceId === 'string' ? request.workspaceId.trim() : ''
  const rawPath = typeof request.path === 'string' ? request.path.trim() : ''
  if (workspaceId.length > 0) {
    const workspace = deps.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) {
      throw statsError('workspace-not-found', 404, 'Unknown workspace.', { workspaceId })
    }
    return { path: workspace.path, title: workspace.title ?? workspace.path }
  }
  if (rawPath.length === 0) {
    throw statsError('missing-target', 400, 'Name a workspace id or a directory path.')
  }
  if (!isAbsolute(rawPath)) {
    throw statsError('relative-path', 400, 'The path must be absolute.', { path: rawPath })
  }
  let canonical
  try {
    canonical = await deps.realpath(rawPath)
  } catch {
    throw statsError('path-not-found', 404, 'The directory does not exist.', { path: rawPath })
  }
  let info
  try {
    info = await stat(canonical)
  } catch {
    throw statsError('path-not-found', 404, 'The directory does not exist.', { path: rawPath })
  }
  if (!info.isDirectory()) {
    throw statsError('not-a-directory', 400, 'The path is not a directory.', { path: rawPath })
  }
  return { path: canonical, title: canonical }
}

/**
 * Build an expected refusal. The shape mirrors the host entry's `MoveError`
 * (`code`, `status`, `message`, `details`) so both routes answer one error
 * envelope; the class lives there because it is the move surface's own.
 *
 * @param code - stable machine code.
 * @param status - HTTP status.
 * @param message - English fallback.
 * @param details - placeholder values.
 * @returns the error to throw.
 */
function statsError(code, status, message, details) {
  const error = new Error(message)
  error.code = code
  error.status = status
  error.details = details
  return error
}

/**
 * @param value - candidate limit.
 * @param fallback - value used when the candidate is unusable.
 * @param max - upper bound.
 * @returns a finite whole number.
 */
function readLimit(value, fallback, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return Math.min(Math.trunc(value), max)
}
