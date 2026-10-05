import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'drainage-pump:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  // 直接探测 localStorage 本身（而不是 window）：浏览器里行为不变，
  // 也让数据层能在注入了 localStorage 垫片的自动化测试里跑通。
  return typeof globalThis !== 'undefined' && !!(globalThis as { localStorage?: unknown }).localStorage
}

function storage(): Storage {
  return (globalThis as unknown as { localStorage: Storage }).localStorage
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (!hasStorage()) {
    return fallback
  }
  const raw = storage().getItem(STORAGE_KEY)
  if (!raw) {
    storage().setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 已持久化的数据优先：存储里出现过的模块（哪怕被清空成空数组）都以存储为准，
    // 只有缺失或已损坏（不是数组）的模块才回退出厂数据，避免真实记录被出厂数据盖回去。
    const merged = clone(SEED_ROWS)
    for (const [key, value] of Object.entries(parsed)) {
      merged[key] = Array.isArray(value) ? value : merged[key]
    }
    return merged
  } catch {
    storage().setItem(STORAGE_KEY, JSON.stringify(fallback))
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

let failCommitOnce = false

// 仅供自动化测试：让下一次提交落盘抛错，验证「失败可重试且不产生重复」。
export function __failNextCommitForTest(): void {
  failCommitOnce = true
}

// 持久化与内存缓存必须同时切换：先完整落盘成功再换缓存，
// 这样存储写失败（隐私模式/配额超限）时内存里仍是旧数据，重试也不会落半份。
function commit(next: Record<string, EntryRow[]>): void {
  if (hasStorage()) {
    const payload = JSON.stringify(next)
    if (failCommitOnce) {
      failCommitOnce = false
      throw new Error('模拟存储写入失败（QuotaExceededError）')
    }
    storage().setItem(STORAGE_KEY, payload)
  }
  cache = next
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commit({ ...allRows(), [key]: rows })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function backupKey(key: string): string {
  return `${STORAGE_KEY}:backup:${key}`
}

function rowsEqual(a: EntryRow[], b: EntryRow[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  // 记录顺序就是播种顺序；逐条完整序列化，任何字段被改动都能识别出来。
  return a.every((row, index) => JSON.stringify(row) === JSON.stringify(b[index]))
}

function isStockRows(key: string, rows: EntryRow[]): boolean {
  return rowsEqual(rows, SEED_ROWS[key] ?? [])
}

function readBackup(key: string): { rows: EntryRow[] } | null {
  if (!hasStorage()) {
    return null
  }
  const raw = storage().getItem(backupKey(key))
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { rows?: EntryRow[] }
    return Array.isArray(parsed.rows) ? { rows: parsed.rows } : null
  } catch {
    return null
  }
}

export type SeedResult = {
  key: string
  rows: EntryRow[]
  changed: boolean
  backedUp: boolean
  backupCount: number
  backupKey: string
}

// 一键播种：
// 1. 播种数据按 idField 去重，编号重复直接拒绝，保证任何情况下都不会写重；
// 2. 现有记录既不是出厂占位数据、也不是上次播种数据时，先整体备份到独立存储槽再覆盖；
//    备份槽已有内容（上一次真正的真实记录）则保留最早那份，反复播种不互相踩踏；
// 3. 整份数据一次落盘后再换缓存：中途抛错时旧数据原样保留，重试得到的仍是确定结果。
export function seedModuleRows(
  key: string,
  seedRows: EntryRow[],
  idField?: string,
): SeedResult {
  const desired = clone(seedRows)
  if (idField) {
    const seen = new Set<string>()
    for (const row of desired) {
      const code = String(row[idField] ?? '')
      if (!code || seen.has(code)) {
        throw new Error(`播种数据里的${idField}「${code || '空'}」重复，已中止，未写入任何数据`)
      }
      seen.add(code)
    }
  }

  const current = clone(listRows(key))
  const alreadySeeded = rowsEqual(current, desired)
  const backupSlot = readBackup(key)

  let backedUp = false
  if (
    !alreadySeeded &&
    !isStockRows(key, current) &&
    current.length > 0 &&
    !backupSlot
  ) {
    if (hasStorage()) {
      storage().setItem(
        backupKey(key),
        JSON.stringify({ key, savedAt: new Date().toISOString(), rows: current }),
      )
    }
    backedUp = true
  }

  if (!alreadySeeded) {
    commit({ ...allRows(), [key]: desired })
  }

  return {
    key,
    rows: clone(desired),
    changed: !alreadySeeded,
    backedUp,
    backupCount: backedUp ? current.length : backupSlot?.rows.length ?? 0,
    backupKey: backupKey(key),
  }
}
