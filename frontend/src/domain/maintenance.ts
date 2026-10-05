import {
  allMaintenanceRecords,
  appendMaintenanceRecord,
  nextMaintenanceRecordId,
} from '@/data/maintenance-store'
import { listRows, saveRows } from '@/data/local-store'
import { MODULE_BY_KEY } from '@/data/modules'
import type {
  ActionResult,
  BackfillReport,
  EquipmentDetail,
  EquipmentSchedule,
  EntryRow,
  MaintenanceOverview,
  MaintenanceRecord,
  RegisterEquipmentInput,
} from '@/data/types'

/**
 * 保养到期日的唯一算法入口。
 *
 * 台账列表页、详情页、概览都只通过本文件的 computeSchedule 取到期日：
 *   到期日 = 推算基准 + 保养周期
 *   推算基准 = 最近一次保养日（历史保养记录与台账字段取最近一次）；无保养记录时回落到购置日期
 * 保养周期的解析、最近一次保养日的选取规则也只在这里出现一次，改动算法只改这一处。
 */

export const EQUIPMENT_KEY = 'drainequipment'
/** 算法版本戳：回填过的设备带上它，之后反复跑回填都不再变动。 */
const ALGO_STAMP = 'maintenance-due-v1'
/** 解析不出保养周期时的兜底周期（天）。 */
const DEFAULT_CYCLE_DAYS = 90
/** 概览口径：到期日距今在此窗口内算「临期」。 */
export const DUE_SOON_DAYS = 30

const CYCLE_FIELD = '保养周期'
const LAST_DATE_FIELD = '上次保养日'
const CODE_FIELD = '设备编号'
const NAME_FIELD = '设备名称'
const STATION_FIELD = '所属泵站'
const PURCHASE_FIELD = '购置日期'
const ROW_STATUS_FIELD = '设备状态'
const ALGO_FIELD = '__maintAlgo'

// ---------- 日期与周期：三处页面共用的唯一一套解析规则 ----------

export function parseDate(text: unknown): string | null {
  if (text === null || text === undefined) {
    return null
  }
  const raw = String(text).trim()
  if (!raw) {
    return null
  }
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

export function todayStr(): string {
  return formatDate(new Date())
}

function shiftDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

/** b - a，按天取整。 */
function daysBetween(a: string, b: string): number {
  const millis = (text: string) => new Date(`${text}T00:00:00`).getTime()
  return Math.round((millis(b) - millis(a)) / 86_400_000)
}

/**
 * 保养周期的唯一解析规则：支持「90天 / 3个月 / 半年 / 一年 / 季度」等常见写法，
 * 解析不出时返回 null，由调用方走兜底周期。任何页面都不得另写一套解析。
 */
export function parseCycleDays(text: unknown): number | null {
  if (text === null || text === undefined) {
    return null
  }
  const raw = String(text).trim()
  if (!raw) {
    return null
  }
  // 季度、半年是约定俗成的固定周期，优先按字面识别。
  if (/季度/.test(raw)) {
    return 91
  }
  if (/半年/.test(raw)) {
    return 182
  }
  const numeric = /(\d+(?:\.\d+)?)/.exec(raw)
  let value = numeric ? Number(numeric[1]) : null
  if (value === null && /(一|两|二)/.test(raw)) {
    value = 1
  }
  if (/周|星期/.test(raw)) {
    return value && value > 0 ? Math.round(value * 7) : null
  }
  if (/月/.test(raw)) {
    return value && value > 0 ? Math.round(value * 30) : null
  }
  if (/年/.test(raw)) {
    return value && value > 0 ? Math.round(value * 365) : null
  }
  if (/天|日/.test(raw)) {
    return value && value > 0 ? Math.round(value) : null
  }
  return null
}

function cycleTextToDays(text: unknown): number {
  return parseCycleDays(text) ?? DEFAULT_CYCLE_DAYS
}

export function normalizeEquipmentCode(code: unknown): string {
  return String(code ?? '').trim().toUpperCase()
}

// ---------- 设备编号是唯一入口：同编号只入账一条 ----------

/** 重复登记的同编号设备只保留最早入账的一条；被合并行上更新的保养日会并入保留行。 */
function dedupeByCode(rows: EntryRow[]): { kept: EntryRow[]; mergedCount: number } {
  const keeperByCode = new Map<string, EntryRow>()
  let mergedCount = 0
  for (const row of rows) {
    const code = normalizeEquipmentCode(row[CODE_FIELD])
    if (!code) {
      keeperByCode.set(`__row-${keeperByCode.size}`, row)
      continue
    }
    const keeper = keeperByCode.get(code)
    if (!keeper) {
      keeperByCode.set(code, row)
      continue
    }
    // 同编号只入账一条；被丢弃行的「上次保养日」若更新，并入保留行，合并不丢最近保养信息。
    mergedCount += 1
    const droppedDate = parseDate(row[LAST_DATE_FIELD])
    const keptDate = parseDate(keeper[LAST_DATE_FIELD])
    if (droppedDate && (!keptDate || droppedDate > keptDate)) {
      keeper[LAST_DATE_FIELD] = droppedDate
    }
  }
  return { kept: [...keeperByCode.values()], mergedCount }
}

/** 所有读路径都从这里拿台账：按设备编号去重后的唯一一份设备清单。 */
export function canonicalEquipmentRows(): EntryRow[] {
  return dedupeByCode(listRows(EQUIPMENT_KEY)).kept
}

export function findEquipmentByCode(code: string): EntryRow | null {
  const normalized = normalizeEquipmentCode(code)
  return canonicalEquipmentRows().find((row) => normalizeEquipmentCode(row[CODE_FIELD]) === normalized) ?? null
}

// ---------- 最近一次保养日：历史记录与台账字段同一套规则取 ----------

export function recordsOfEquipment(code: string): MaintenanceRecord[] {
  const normalized = normalizeEquipmentCode(code)
  return allMaintenanceRecords()
    .filter((record) => normalizeEquipmentCode(record.equipmentCode) === normalized)
    .slice()
    .sort((a, b) => (a.maintenanceDate < b.maintenanceDate ? 1 : -1))
}

type Basis = { date: string; source: EquipmentSchedule['basisSource'] }

/** 历史保养记录与台账「上次保养日」冲突时，以最近一次保养日为准。 */
function resolveBasis(row: EntryRow): { basis: Basis; conflict: boolean } {
  const ledgerDate = parseDate(row[LAST_DATE_FIELD])
  const records = recordsOfEquipment(String(row[CODE_FIELD] ?? ''))
  const recordDate = records.length > 0 ? records[0].maintenanceDate : null

  const candidates: Basis[] = []
  if (recordDate) {
    candidates.push({ date: recordDate, source: '保养记录' })
  }
  if (ledgerDate) {
    candidates.push({ date: ledgerDate, source: '台账上次保养日' })
  }
  candidates.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const purchaseDate = parseDate(row[PURCHASE_FIELD])
  if (candidates.length === 0) {
    return {
      basis: { date: purchaseDate ?? todayStr(), source: '购置日期' },
      conflict: false,
    }
  }
  const conflict = Boolean(recordDate && ledgerDate && recordDate !== ledgerDate)
  return { basis: candidates[0], conflict }
}

// ---------- 唯一的到期推算：三处页面读到的是同一份结果 ----------

export function computeSchedule(row: EntryRow, today: string = todayStr()): EquipmentSchedule {
  const code = normalizeEquipmentCode(row[CODE_FIELD])
  const cycleDays = cycleTextToDays(row[CYCLE_FIELD])
  const { basis } = resolveBasis(row)
  const dueDate = shiftDays(basis.date, cycleDays)
  const daysToDue = daysBetween(today, dueDate)
  const scrapped = String(row.status) === '已报废'
  return {
    equipmentCode: code,
    cycleDays,
    basisDate: basis.date,
    basisSource: basis.source,
    baseDate: basis.date,
    dueDate,
    overdue: !scrapped && daysToDue < 0,
    daysToDue,
  }
}

/** 列表行附上统一算法算出的到期日，供台账表格直接展示。 */
export function equipmentRowsWithSchedule(today: string = todayStr()): {
  row: EntryRow
  schedule: EquipmentSchedule
}[] {
  return canonicalEquipmentRows().map((row) => ({ row, schedule: computeSchedule(row, today) }))
}

export function equipmentDetailByCode(code: string): EquipmentDetail | null {
  const row = findEquipmentByCode(code)
  if (!row) {
    return null
  }
  return {
    row,
    schedule: computeSchedule(row),
    records: recordsOfEquipment(normalizeEquipmentCode(code)),
  }
}

/** 概览口径同样来自 computeSchedule，不再拿设备状态硬凑。 */
export function equipmentOverview(today: string = todayStr()): MaintenanceOverview {
  const pairs = equipmentRowsWithSchedule(today)
  const items = pairs.map(({ row, schedule }) => ({
    equipmentCode: schedule.equipmentCode,
    equipmentName: String(row[NAME_FIELD] ?? '—'),
    station: String(row[STATION_FIELD] ?? '—'),
    status: String(row.status),
    dueDate: schedule.dueDate,
    daysToDue: schedule.daysToDue,
    overdue: schedule.overdue,
  }))
  return {
    total: pairs.length,
    overdue: pairs.filter(({ schedule }) => schedule.overdue).length,
    dueSoon: pairs.filter(
      ({ row, schedule }) =>
        String(row.status) !== '已报废' &&
        !schedule.overdue &&
        schedule.daysToDue <= DUE_SOON_DAYS,
    ).length,
    maintained: pairs.filter(({ row }) => String(row.status) === '已保养').length,
    scrapped: pairs.filter(({ row }) => String(row.status) === '已报废').length,
    items,
  }
}

// ---------- 存量回填：可反复跑、不写重、算过的不再动、冲突以最近保养日为准 ----------

/**
 * 把存量历史设备按统一算法回填一遍：
 * - 同编号重复登记只保留一条（可反复执行，后续执行不再有可合并项）
 * - 已带当前算法版本戳的设备完全不动
 * - 未回填设备：周期归一化、上次保养日与历史记录核对（冲突取最近）、补齐版本戳
 * - 幂等：没有任何改动时不落盘
 */
export function backfillEquipmentMaintenance(): BackfillReport {
  const rows = listRows(EQUIPMENT_KEY)
  const { kept, mergedCount } = dedupeByCode(rows)
  const records = allMaintenanceRecords()

  let backfilled = 0
  let conflictsResolved = 0
  let unchanged = 0

  for (const row of kept) {
    if (row[ALGO_FIELD] === ALGO_STAMP) {
      unchanged += 1
      continue
    }

    const cycleDays = cycleTextToDays(row[CYCLE_FIELD])
    row[CYCLE_FIELD] = `${cycleDays}天`

    const ledgerDate = parseDate(row[LAST_DATE_FIELD])
    const recordDates = records
      .filter((record) => normalizeEquipmentCode(record.equipmentCode) === normalizeEquipmentCode(row[CODE_FIELD]))
      .map((record) => record.maintenanceDate)
      .sort()
    const latestRecordDate = recordDates.length > 0 ? recordDates[recordDates.length - 1] : null

    if (ledgerDate && latestRecordDate && latestRecordDate !== ledgerDate) {
      conflictsResolved += 1
    }
    const latest = [ledgerDate, latestRecordDate].filter(Boolean).sort().pop()
    if (latest) {
      row[LAST_DATE_FIELD] = latest
    }

    row[ROW_STATUS_FIELD] = String(row.status)
    row[ALGO_FIELD] = ALGO_STAMP
    backfilled += 1
  }

  const changed = backfilled > 0 || mergedCount > 0
  if (changed) {
    saveRows(EQUIPMENT_KEY, kept)
  }

  return {
    scanned: rows.length,
    backfilled,
    duplicatesMerged: mergedCount,
    conflictsResolved,
    unchanged,
  }
}

// ---------- 设备状态：待保养 → 运行中 → 已保养 单向推进（已报废为终态） ----------

function equipmentMeta() {
  const meta = MODULE_BY_KEY.get(EQUIPMENT_KEY)
  if (!meta) {
    throw new Error('排水设备台账模块未登记')
  }
  return meta
}

export function assertForwardTransition(
  statuses: readonly string[],
  current: string,
  target: string,
  entity: string,
): ActionResult | null {
  if (current === target) {
    return { ok: false, message: `${entity}已经是「${target}」，不用重复操作` }
  }
  const from = statuses.indexOf(current)
  const to = statuses.indexOf(target)
  if (from >= 0 && to >= 0 && to < from) {
    return { ok: false, message: `设备状态只能单向推进，不能从「${current}」回退到「${target}」` }
  }
  return null
}

/** 完成保养：登记一条当日保养记录，状态推进到「已保养」，到期日随即由统一算法重算。 */
export function completeEquipmentMaintenance(id: number, dateText?: string): ActionResult {
  const meta = equipmentMeta()
  const rows = listRows(EQUIPMENT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)
  const target = '已保养'
  const blocked = assertForwardTransition(meta.statuses, current, target, meta.entity)
  if (blocked) {
    return blocked
  }

  const date = parseDate(dateText) ?? todayStr()
  appendMaintenanceRecord({
    id: nextMaintenanceRecordId(),
    equipmentCode: normalizeEquipmentCode(row[CODE_FIELD]),
    maintenanceDate: date,
    source: '现场完成保养',
  })

  // 以最近一次保养日为准（手工补录日期早于既有记录时不会把最近日期改旧）。
  const ledgerDate = parseDate(row[LAST_DATE_FIELD])
  row[LAST_DATE_FIELD] = !ledgerDate || date >= ledgerDate ? date : ledgerDate
  row.status = target
  row.pending = false
  row.abnormal = false
  row[ROW_STATUS_FIELD] = target
  row[ALGO_FIELD] = ALGO_STAMP
  saveRows(EQUIPMENT_KEY, [...rows.slice(0, index), row, ...rows.slice(index + 1)])
  return { ok: true, message: `${meta.entity}已完成保养，保养到期日已重算为 ${computeSchedule(row).dueDate}` }
}

/** 设备登记：设备编号为唯一入口，同编号重复登记只入账一条。 */
export function registerEquipment(input: RegisterEquipmentInput): ActionResult {
  const code = normalizeEquipmentCode(input.equipmentCode)
  if (!code) {
    return { ok: false, message: '设备编号不能为空' }
  }
  if (!input.equipmentName.trim()) {
    return { ok: false, message: '设备名称不能为空' }
  }
  const purchaseDate = parseDate(input.purchaseDate)
  if (!purchaseDate) {
    return { ok: false, message: '购置日期格式不正确，应为 YYYY-MM-DD' }
  }
  const cycleDays = parseCycleDays(input.cycleText)
  if (cycleDays === null) {
    return { ok: false, message: '保养周期无法识别，请填写如 90天、3个月、季度、半年' }
  }
  const lastDate = input.lastMaintenanceDate ? parseDate(input.lastMaintenanceDate) : null
  if (input.lastMaintenanceDate && !lastDate) {
    return { ok: false, message: '上次保养日格式不正确，应为 YYYY-MM-DD' }
  }

  backfillEquipmentMaintenance()
  if (findEquipmentByCode(code)) {
    return { ok: false, message: `设备编号 ${code} 已登记，同一编号只入账一条` }
  }

  const rows = listRows(EQUIPMENT_KEY)
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '待保养',
    pending: true,
    abnormal: false,
    [CODE_FIELD]: code,
    [NAME_FIELD]: input.equipmentName.trim(),
    ['设备型号']: input.equipmentModel.trim(),
    [STATION_FIELD]: input.station.trim(),
    [PURCHASE_FIELD]: purchaseDate,
    [CYCLE_FIELD]: `${cycleDays}天`,
    [LAST_DATE_FIELD]: lastDate ?? '',
    [ROW_STATUS_FIELD]: '待保养',
    [ALGO_FIELD]: ALGO_STAMP,
  }
  saveRows(EQUIPMENT_KEY, [...rows, row])

  if (lastDate) {
    appendMaintenanceRecord({
      id: nextMaintenanceRecordId(),
      equipmentCode: code,
      maintenanceDate: lastDate,
      source: '设备登记补录',
    })
  }
  return { ok: true, message: `设备 ${code} 已登记，保养到期日为 ${computeSchedule(row).dueDate}` }
}
