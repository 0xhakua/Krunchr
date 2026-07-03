import fs from 'fs'
import path from 'path'

const STORAGE_PATH = process.env.STORAGE_PATH ?? '/app/storage'
const STORAGE_TYPE = process.env.STORAGE_TYPE ?? 'local'

export function getStoragePath(): string {
  return STORAGE_PATH
}

export function getStorageType(): string {
  return STORAGE_TYPE
}

function resolveStoragePath(inputPath: string): string {
  // Backward compatibility: some existing records store the absolute path
  // returned by older versions of writeFile. Relative paths are preferred
  // because they survive STORAGE_PATH changes and ephemeral filesystems.
  if (path.isAbsolute(inputPath)) {
    return inputPath
  }
  return path.join(STORAGE_PATH, inputPath)
}

export async function writeFile(localPath: string, buffer: Buffer): Promise<string> {
  const fullPath = path.join(STORAGE_PATH, localPath)
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.promises.writeFile(fullPath, buffer)
  // Persist the relative path so the storage root can move or be remounted
  // without invalidating database records.
  return localPath
}

export async function readFile(localPath: string): Promise<Buffer> {
  const fullPath = resolveStoragePath(localPath)
  return fs.promises.readFile(fullPath)
}

export function fileExists(localPath: string): boolean {
  const fullPath = resolveStoragePath(localPath)
  return fs.existsSync(fullPath)
}

export interface StorageHealth {
  ok: boolean
  type: string
  path: string
  writable: boolean
  message: string
}

/**
 * Probe the configured storage backend. For the local/Railway filesystem
 * driver we check that the directory is creatable and writable; a tiny temp
 * file is written and removed.
 */
export async function checkStorageHealth(): Promise<StorageHealth> {
  const base: Omit<StorageHealth, 'ok' | 'writable' | 'message'> = {
    type: STORAGE_TYPE,
    path: STORAGE_PATH,
  }
  try {
    await fs.promises.mkdir(STORAGE_PATH, { recursive: true })
    const probe = path.join(STORAGE_PATH, `.kuwenta-health-${process.pid}-${Date.now()}`)
    await fs.promises.writeFile(probe, 'ok')
    await fs.promises.unlink(probe)
    return { ...base, ok: true, writable: true, message: 'Storage is writable' }
  } catch (err) {
    return {
      ...base,
      ok: false,
      writable: false,
      message: err instanceof Error ? err.message : 'Storage is not writable',
    }
  }
}

export interface StorageStats {
  path: string
  type: string
  writable: boolean
  freeBytes: number | null
  totalBytes: number | null
  message: string
  ok: boolean
}

/**
 * Storage stats + health, with the disk's free space and total size.
 * Used by the admin system-health panel.
 *
 * `statfs` is unavailable in older Node versions; we fall back to a soft
 * warning so the panel still renders. The Railway / Linux hosts we target
 * all have Node 20+ and the `statfs` function, so this is a safety net.
 */
export async function checkStorageStats(): Promise<StorageStats> {
  const health = await checkStorageHealth()
  let freeBytes: number | null = null
  let totalBytes: number | null = null
  try {
    if (typeof fs.promises.statfs === 'function') {
      const stats = await fs.promises.statfs(STORAGE_PATH)
      freeBytes = Number(stats.bavail) * Number(stats.bsize)
      totalBytes = Number(stats.blocks) * Number(stats.bsize)
    } else {
      // Last-ditch fallback for systems without statfs. The admin panel will
      // show "n/a" for free space.
    }
  } catch (err) {
    return {
      ...health,
      freeBytes: null,
      totalBytes: null,
      message: `${health.message} (stats: ${err instanceof Error ? err.message : 'unavailable'})`,
    }
  }
  return {
    ...health,
    freeBytes,
    totalBytes,
    message: freeBytes === null ? health.message : health.message,
  }
}
