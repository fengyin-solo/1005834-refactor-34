import { listHistory, MAINT_ALGO_VERSION } from './maint-store'
import type { EntryRow } from './types'
import type { BackfillResult, MaintenanceViewEntry, MaintenanceHistoryRecord } from './types'

/**
 * 排水设备保养到期日：全应用唯一的一套算法。
 *
 * 台账列表页、设备详情页、运营概览都只能通过本模块读取推算结果，
 * 不允许各自再算一遍。设备编号（设备编号 字段）是唯一入口：
 * 同一设备编号只认一条入账记录，保养周期与上次保养日也都按同一套规则取。
 */

export const DRAINAGE_KEY = 'drainequipment'
export const DEVICE_CODE_FIELD = '设备编号'
export const CYCLE_FIELD = '保养周期'
export const LAST_MAINT_FIELD = '上次保养日'
export const PURCHASE_FIELD = '购置日期'
export const DUE_FIELD = '保养到期日'
/** 推算基准天数：保养到期日落在今天起 N 天内视为「即将到期」。 */
export const DUE_SOON_DAYS = 30
/** 周期写不清时兜底按 90 天。 */
export const DEFAULT_CYCLE_DAYS = 90

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function todayString(): string {
  return toDateString(new Date())
}

/** 只认 YYYY-MM-DD（或可解析的日期串），非法日期返回 null。 */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null
  }
  const text = value.trim()
  if (!text) {
    return null
  }
  const matched = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text)
  const date = matched
    ? new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
    : new Date(text)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date
}

type ParsedCycle = { amount: number; unit: 'month' | 'day' }

/**
 * 保养周期解析：必须整体是「数字 + 可选单位（天/日/月）」。
 * 写不清的一律按 90 天兜底。
 */
export function parseCycle(value: unknown): ParsedCycle {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { amount: value, unit: 'day' }
  }
  const text = String(value ?? '').trim().toLowerCase()
  const matched = /^(\d+(?:\.\d+)?)\s*(个月?|天|日)?$/.exec(text)
  if (!matched) {
    return { amount: DEFAULT_CYCLE_DAYS, unit: 'day' }
  }
  const amount = Number(matched[1])
  if (!Number.isFinite(amount) || amount <= 0) {
    return { amount: DEFAULT_CYCLE_DAYS, unit: 'day' }
  }
  return { amount, unit: matched[2] === '月' || matched[2] === '个月' ? 'month' : 'day' }
}

/**
 * 保养周期统一换算成天数。
 * 支持「90」「90天」「3个月」这类写法；纯数字按天；写不清的按 90 天兜底。
 */
export function parseCycleDays(value: unknown): number {
  const { amount, unit } = parseCycle(value)
  return unit === 'month' ? Math.round(amount * 30) : Math.round(amount)
}

function shiftDays(base: Date, days: number): Date {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  date.setDate(date.getDate() + days)
  return date
}

/** 保养到期日 = 上次保养日 + 一个保养周期（按月写的按自然月推进，月末自动夹到当月最后一天）。 */
export function computeDueDate(base: Date, cycleValue: unknown): string {
  const { amount, unit } = parseCycle(cycleValue)
  if (unit === 'month') {
    const months = Math.trunc(amount)
    const target = new Date(base.getFullYear(), base.getMonth() + months, 1)
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    const day = Math.min(base.getDate(), lastDay)
    return toDateString(new Date(target.getFullYear(), target.getMonth(), day))
  }
  return toDateString(shiftDays(base, Math.round(amount)))
}

/** 取该设备编号下最近一次保养日：历史保养记录优先，取不到再看台账上次保养日。 */
export function resolveLastMaintDate(
  row: EntryRow,
  history: MaintenanceHistoryRecord[],
): string {
  const dates = history
    .map((item) => item['保养日期'])
    .map((value) => parseDate(value))
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime())
  if (dates.length > 0) {
    return toDateString(dates[0])
  }
  const ledger = parseDate(row[LAST_MAINT_FIELD])
  if (ledger) {
    return toDateString(ledger)
  }
  const purchase = parseDate(row[PURCHASE_FIELD])
  return purchase ? toDateString(purchase) : ''
}

type ResolvedInput = {
  row: EntryRow
  history: MaintenanceHistoryRecord[]
}

function buildViewEntry({ row, history }: ResolvedInput): MaintenanceViewEntry {
  const cycle = String(row[CYCLE_FIELD] ?? '').trim()
  const cycleDays = parseCycleDays(cycle)
  const lastMaint = resolveLastMaintDate(row, history)
  const base = parseDate(lastMaint)
  const due = base ? computeDueDate(base, cycle || cycleDays) : ''
  const today = todayString()
  const overdue = due !== '' && due < today
  const dueSoon =
    !overdue && due !== '' && due <= toDateString(shiftDays(new Date(), DUE_SOON_DAYS))
  return {
    id: row.id,
    设备编号: String(row[DEVICE_CODE_FIELD] ?? ''),
    设备名称: String(row['设备名称'] ?? ''),
    设备型号: String(row['设备型号'] ?? ''),
    所属泵站: String(row['所属泵站'] ?? ''),
    购置日期: String(row[PURCHASE_FIELD] ?? ''),
    保养周期: cycle || `${cycleDays}天`,
    上次保养日: lastMaint,
    保养到期日: due,
    状态: String(row.status ?? ''),
    逾期: overdue,
    即将到期: dueSoon,
  }
}

/**
 * 保养到期日的唯一读口：以设备编号归并。
 * 同一设备编号重复登记时只认第一条入账记录，其余视为重复记录，不进推算结果。
 * 已经按新算法回填过的设备（带版本戳）直接读回填值，未回填的现场按同一套算法推算，
 * 因此列表页、详情页、概览拿到的永远是同一份结果。
 */
export function equipmentMaintSchedule(
  rows: EntryRow[] = [],
  history: MaintenanceHistoryRecord[] = listHistory(),
): MaintenanceViewEntry[] {
  const historyByCode = new Map<string, MaintenanceHistoryRecord[]>()
  for (const record of history) {
    const code = String(record[DEVICE_CODE_FIELD] ?? '').trim()
    if (!code) {
      continue
    }
    const bucket = historyByCode.get(code)
    if (bucket) {
      bucket.push(record)
    } else {
      historyByCode.set(code, [record])
    }
  }

  const canonical = new Map<string, EntryRow>()
  for (const row of rows) {
    const code = String(row[DEVICE_CODE_FIELD] ?? '').trim()
    if (!code || canonical.has(code)) {
      continue
    }
    canonical.set(code, row)
  }

  return [...canonical.entries()].map(([code, row]) =>
    buildViewEntry({ row, history: historyByCode.get(code) ?? [] }),
  )
}

export function findEquipment(
  idOrCode: number | string,
  rows: EntryRow[] = [],
  history: MaintenanceHistoryRecord[] = listHistory(),
): MaintenanceViewEntry | null {
  const list = equipmentMaintSchedule(rows, history)
  if (typeof idOrCode === 'number') {
    return list.find((item) => item.id === idOrCode) ?? null
  }
  const code = String(idOrCode).trim()
  return list.find((item) => item.设备编号 === code) ?? null
}

export function historyOfEquipment(
  code: string,
  history: MaintenanceHistoryRecord[] = listHistory(),
): MaintenanceHistoryRecord[] {
  return history
    .filter((item) => String(item[DEVICE_CODE_FIELD] ?? '').trim() === code)
    .slice()
    .sort(
      (a, b) =>
        (parseDate(b['保养日期'])?.getTime() ?? 0) -
        (parseDate(a['保养日期'])?.getTime() ?? 0),
    )
}

export type MaintenanceSummary = {
  total: number
  overdue: number
  dueSoon: number
  pendingMaint: number
  maintained: number
  scrapped: number
}

/** 概览统计也只认 equipmentMaintSchedule 的结果，不再拿设备状态凑日子。 */
export function maintenanceSummary(
  rows: EntryRow[] = [],
  history: MaintenanceHistoryRecord[] = listHistory(),
): MaintenanceSummary {
  const list = equipmentMaintSchedule(rows, history)
  return {
    total: list.length,
    overdue: list.filter((item) => item.逾期).length,
    dueSoon: list.filter((item) => item.即将到期).length,
    pendingMaint: list.filter((item) => item.状态 === '待保养').length,
    maintained: list.filter((item) => item.状态 === '已保养').length,
    scrapped: list.filter((item) => item.状态 === '已报废').length,
  }
}

/**
 * 存量历史设备回填：可反复跑，天然幂等。
 * - 已按新算法算过（带版本戳）的设备一律不再变动；
 * - 重复编号只入账第一条，重复条目标记异常且不参与推算；
 * - 上次保养日与历史保养记录冲突时，以最近一次保养日为准；
 * - 回填只把推算结果写回台账，保养到期日仍由统一读口对外提供。
 */
export function backfillMaintenance(
  rows: EntryRow[],
  history: MaintenanceHistoryRecord[] = listHistory(),
): { rows: EntryRow[]; result: BackfillResult } {
  const stamped = rows.some((row) => row.__maintVersion === MAINT_ALGO_VERSION)
  const result: BackfillResult = {
    updated: 0,
    duplicated: 0,
    skipped: 0,
    historyConflicts: [],
    ran: false,
    alreadyStamped: stamped,
  }

  const latestByCode = new Map<string, string>()
  for (const record of history) {
    const code = String(record[DEVICE_CODE_FIELD] ?? '').trim()
    const date = parseDate(record['保养日期'])
    if (!code || !date) {
      continue
    }
    const current = latestByCode.get(code)
    const formatted = toDateString(date)
    if (!current || formatted > current) {
      latestByCode.set(code, formatted)
    }
  }

  const seen = new Set<string>()
  const next = rows.map((row) => {
    const code = String(row[DEVICE_CODE_FIELD] ?? '').trim()
    if (!code) {
      result.skipped += 1
      return row
    }
    if (seen.has(code)) {
      result.duplicated += 1
      return { ...row, abnormal: true }
    }
    seen.add(code)

    if (row.__maintVersion === MAINT_ALGO_VERSION) {
      result.skipped += 1
      return row
    }

    const ledgerLast = parseDate(row[LAST_MAINT_FIELD])
    const historyLatest = latestByCode.get(code)
    let lastMaint = ledgerLast ? toDateString(ledgerLast) : ''
    if (historyLatest) {
      if (!ledgerLast || historyLatest > lastMaint) {
        result.historyConflicts.push({
          设备编号: code,
          台账上次保养日: lastMaint,
          最近保养日: historyLatest,
        })
      }
      lastMaint = historyLatest
    }
    if (!lastMaint) {
      const purchase = parseDate(row[PURCHASE_FIELD])
      lastMaint = purchase ? toDateString(purchase) : ''
    }

    const base = parseDate(lastMaint)
    const due = base ? computeDueDate(base, row[CYCLE_FIELD]) : ''
    result.updated += 1
    result.ran = true
    return {
      ...row,
      [LAST_MAINT_FIELD]: lastMaint,
      [DUE_FIELD]: due,
      __maintVersion: MAINT_ALGO_VERSION,
    }
  })

  return { rows: next, result }
}
