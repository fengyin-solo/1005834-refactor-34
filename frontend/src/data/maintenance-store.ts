import { SEED_MAINTENANCE_RECORDS } from './seed'
import type { MaintenanceRecord } from './types'

// 历史保养记录单独存放一份，和台账数据互不覆盖：回填时拿它与台账上的「上次保养日」核对。
const MAINTENANCE_KEY = 'drainage-pump:maintenance-records'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): MaintenanceRecord[] {
  const fallback = clone(SEED_MAINTENANCE_RECORDS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(MAINTENANCE_KEY)
  if (!raw) {
    window.localStorage.setItem(MAINTENANCE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as MaintenanceRecord[]
  } catch {
    window.localStorage.setItem(MAINTENANCE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: MaintenanceRecord[] | null = null

export function allMaintenanceRecords(): MaintenanceRecord[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveMaintenanceRecords(records: MaintenanceRecord[]): void {
  cache = records
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(MAINTENANCE_KEY, JSON.stringify(records))
  }
}

export function appendMaintenanceRecord(record: MaintenanceRecord): void {
  saveMaintenanceRecords([...allMaintenanceRecords(), record])
}

export function nextMaintenanceRecordId(): number {
  return allMaintenanceRecords().reduce((max, item) => Math.max(max, item.id), 0) + 1
}

export function maintenanceStorageKey(): string {
  return MAINTENANCE_KEY
}
