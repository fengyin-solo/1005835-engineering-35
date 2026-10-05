import { SEED_ROWS } from './seed'
import type { BackupSnapshot, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'drainage-pump:entries'
// 一键播种覆盖前的备份快照，放在单独的键下，不影响正式数据。
const BACKUP_KEY = 'drainage-pump:entries:backup'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 整体替换全部模块数据：先写存储再换缓存，写失败时缓存不动，重试不会留下半截状态。
export function replaceAllRows(next: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
}

// 覆盖前把当前整份数据快照到备份键，重复播种不会反复叠备份。
export function backupRows(snapshot: Record<string, EntryRow[]>): void {
  const payload: BackupSnapshot = { savedAt: new Date().toISOString(), rows: clone(snapshot) }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(BACKUP_KEY, JSON.stringify(payload))
  }
}

export function readBackup(): BackupSnapshot | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(BACKUP_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as BackupSnapshot
  } catch {
    return null
  }
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function backupKey(): string {
  return BACKUP_KEY
}
