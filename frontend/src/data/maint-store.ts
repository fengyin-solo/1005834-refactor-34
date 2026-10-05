import { SEED_MAINT_HISTORY } from './seed'
import type { MaintenanceHistoryRecord } from './types'

// 历史保养记录单独存一份：回填与完成保养都以「设备编号 + 保养日期」挂到台账设备上。
const HISTORY_KEY = 'drainage-pump:maintenance-history'
/** 台账历史设备是否已经跑过新算法回填（整体标记，跑过一次即可）。 */
export const MIGRATION_FLAG_KEY = 'drainage-pump:maintenance-migrated'
export const HISTORY_VERSION_KEY = 'drainage-pump:maintenance-history-version'
/** 保养到期日算法版本：写进每条已回填/已推算设备，换算法时升版本，旧设备会再回填一次。 */
export const MAINT_ALGO_VERSION = 'maint-due-v1'
const HISTORY_VERSION = '1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeHistory(records: MaintenanceHistoryRecord[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(records))
    window.localStorage.setItem(HISTORY_VERSION_KEY, HISTORY_VERSION)
  }
}

function readHistory(): MaintenanceHistoryRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(SEED_MAINT_HISTORY)
  }
  const raw = window.localStorage.getItem(HISTORY_KEY)
  if (!raw) {
    const fallback = clone(SEED_MAINT_HISTORY)
    writeHistory(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as MaintenanceHistoryRecord[]
    return Array.isArray(parsed) ? parsed : clone(SEED_MAINT_HISTORY)
  } catch {
    const fallback = clone(SEED_MAINT_HISTORY)
    writeHistory(fallback)
    return fallback
  }
}

let cache: MaintenanceHistoryRecord[] | null = null

export function listHistory(): MaintenanceHistoryRecord[] {
  if (cache === null) {
    cache = readHistory()
  }
  return cache
}

export function saveHistory(records: MaintenanceHistoryRecord[]): void {
  cache = records
  writeHistory(records)
}

export function appendHistory(record: MaintenanceHistoryRecord): MaintenanceHistoryRecord[] {
  const next = [...listHistory(), record]
  saveHistory(next)
  return next
}

export function nextHistoryId(): number {
  return listHistory().reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

export function isBackfilled(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false
  }
  return window.localStorage.getItem(MIGRATION_FLAG_KEY) === MAINT_ALGO_VERSION
}

export function markBackfilled(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(MIGRATION_FLAG_KEY, MAINT_ALGO_VERSION)
  }
}

export function resetHistory(): MaintenanceHistoryRecord[] {
  const fallback = clone(SEED_MAINT_HISTORY)
  saveHistory(fallback)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(MIGRATION_FLAG_KEY)
  }
  return fallback
}

export function historyStorageKey(): string {
  return HISTORY_KEY
}
