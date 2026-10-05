import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  appendHistory,
  isBackfilled,
  listHistory,
  markBackfilled,
  nextHistoryId,
  resetHistory,
} from '@/data/maint-store'
import {
  backfillMaintenance,
  computeDueDate,
  CYCLE_FIELD,
  DEFAULT_CYCLE_DAYS,
  DEVICE_CODE_FIELD,
  DRAINAGE_KEY,
  DUE_FIELD,
  equipmentMaintSchedule,
  historyOfEquipment,
  LAST_MAINT_FIELD,
  maintenanceSummary,
  parseCycleDays,
  parseDate,
  PURCHASE_FIELD,
  toDateString,
} from '@/data/maintenance'
import type {
  ActionResult,
  BackfillResult,
  EntryRow,
  MaintenanceViewEntry,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// ---------------------------------------------------------------------------
// 排水设备：保养到期日
// 台账列表、详情页、概览全部从 equipmentMaintSchedule 这一个读口取推算结果，
// 三处永远是同一份；写操作（完成保养 / 登记 / 回填）也只在这里收口。
// ---------------------------------------------------------------------------

// 排水设备状态单向推进的次序：只许往后走，不许回退；已报废是终态。
const DEVICE_STATUS_ORDER = ['待保养', '运行中', '已保养', '已报废']

function toEntryRow(view: MaintenanceViewEntry): EntryRow {
  return {
    id: view.id,
    status: view.状态,
    pending: view.状态 !== '已报废',
    abnormal: view.逾期,
    设备编号: view.设备编号,
    设备名称: view.设备名称,
    设备型号: view.设备型号,
    所属泵站: view.所属泵站,
    购置日期: view.购置日期,
    保养周期: view.保养周期,
    上次保养日: view.上次保养日,
    保养到期日: view.保养到期日,
  }
}

/** 存量设备首次读取时自动回填一遍；幂等，跑过一次（版本戳）就不再写。 */
function ensureBackfilled(): void {
  if (isBackfilled()) {
    return
  }
  runBackfill()
}

export function runBackfill(): BackfillResult {
  const { rows, result } = backfillMaintenance(listRows(DRAINAGE_KEY), listHistory())
  if (result.ran || result.duplicated > 0) {
    saveRows(DRAINAGE_KEY, rows)
  }
  markBackfilled()
  return result
}

function deviceViews(): MaintenanceViewEntry[] {
  ensureBackfilled()
  return equipmentMaintSchedule(listRows(DRAINAGE_KEY), listHistory())
}

function listDrainageEquipment(filters: Record<string, string>): PageResult {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const matched = deviceViews()
    .filter((view) =>
      pairs.every(([field, value]) => String(view[field as keyof MaintenanceViewEntry] ?? '').includes(value.trim())),
    )
    .map(toEntryRow)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export type EquipmentDetail = {
  view: MaintenanceViewEntry
  history: ReturnType<typeof historyOfEquipment>
}

export function getEquipmentDetail(id: number): EquipmentDetail | null {
  const view = deviceViews().find((item) => item.id === id) ?? null
  if (!view) {
    return null
  }
  return { view, history: historyOfEquipment(view.设备编号, listHistory()) }
}

export function maintenanceOverview() {
  ensureBackfilled()
  return maintenanceSummary(listRows(DRAINAGE_KEY), listHistory())
}

export type EquipmentDraft = {
  设备编号: string
  设备名称: string
  设备型号: string
  所属泵站: string
  购置日期: string
  保养周期: string
}

/** 登记排水设备：设备编号是唯一入口，重复编号只入账第一条，这里直接拒收重复登记。 */
export function createEquipment(draft: EquipmentDraft): ActionResult {
  const code = draft.设备编号.trim()
  if (!code) {
    return { ok: false, message: '设备编号不能为空' }
  }
  ensureBackfilled()
  const rows = listRows(DRAINAGE_KEY)
  const duplicated = rows.some((row) => String(row[DEVICE_CODE_FIELD] ?? '').trim() === code)
  if (duplicated) {
    return { ok: false, message: `设备编号 ${code} 已登记，同一设备编号只能入账一条` }
  }
  if (draft.设备名称.trim() === '') {
    return { ok: false, message: '设备名称不能为空' }
  }
  const purchase = parseDate(draft.购置日期)
  if (!purchase) {
    return { ok: false, message: '购置日期格式不正确，需要形如 2026-09-01' }
  }
  const cycle = draft.保养周期.trim() || `${parseCycleDays(draft.保养周期)}天`
  const lastMaint = toDateString(purchase)
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id,
    status: '待保养',
    pending: true,
    abnormal: false,
    [DEVICE_CODE_FIELD]: code,
    设备名称: draft.设备名称.trim(),
    设备型号: draft.设备型号.trim(),
    所属泵站: draft.所属泵站.trim(),
    [PURCHASE_FIELD]: lastMaint,
    [CYCLE_FIELD]: cycle,
    [LAST_MAINT_FIELD]: lastMaint,
    [DUE_FIELD]: computeDueDate(purchase, cycle),
    // 新设备直接按新算法入账，后续回填不再动它。
    __maintVersion: 'maint-due-v1',
  }
  saveRows(DRAINAGE_KEY, [...rows, row])
  return { ok: true, message: `排水设备 ${code} 已登记，当前状态「待保养」` }
}

function runDeviceAction(id: number, action: string): ActionResult {
  const targetMap: Record<string, string> = { 登记运行: '运行中', 完成保养: '已保养', 报废设备: '已报废' }
  const target = targetMap[action]
  if (!target) {
    return { ok: false, message: `排水设备没有登记「${action}」这个动作` }
  }
  ensureBackfilled()
  const rows = listRows(DRAINAGE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的排水设备` }
  }
  const current = String(rows[index].status)
  const currentOrder = DEVICE_STATUS_ORDER.indexOf(current)
  const targetOrder = DEVICE_STATUS_ORDER.indexOf(target)
  if (current === '已报废' || current === target) {
    return { ok: false, message: `排水设备已经是「${current}」，不用重复操作` }
  }
  if (currentOrder < 0 || targetOrder < 0 || targetOrder <= currentOrder) {
    return { ok: false, message: `排水设备状态只能从「${current}」单向推进，不能${action}到「${target}」` }
  }

  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== '已报废',
    abnormal: false,
  }

  if (action === '完成保养') {
    const today = new Date()
    const todayText = toDateString(today)
    const cycle = String(updated[CYCLE_FIELD] ?? '').trim() || `${DEFAULT_CYCLE_DAYS}天`
    // 完成保养：上次保养日推进到今天，到期日由同一套算法重算，并留下一条历史保养记录。
    updated[LAST_MAINT_FIELD] = todayText
    updated[DUE_FIELD] = computeDueDate(today, cycle)
    updated.__maintVersion = 'maint-due-v1'
    appendHistory({
      id: nextHistoryId(),
      设备编号: String(updated[DEVICE_CODE_FIELD] ?? ''),
      保养日期: todayText,
      保养内容: '手动登记保养完成',
      保养人: '值班人员',
    })
  }

  const next = [...rows]
  next[index] = updated
  saveRows(DRAINAGE_KEY, next)
  return { ok: true, message: `排水设备已${action}，当前状态「${target}」` }
}

// ---------------------------------------------------------------------------
// 通用模块
// ---------------------------------------------------------------------------

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  if (key === DRAINAGE_KEY) {
    return listDrainageEquipment(filters)
  }
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === DRAINAGE_KEY) {
    return runDeviceAction(id, action)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  if (key === DRAINAGE_KEY) {
    resetHistory()
  }
  resetRows(key)
  return listEntries(key)
}

const DRAINAGE_EXPORT_FIELDS = [
  '设备编号',
  '设备名称',
  '设备型号',
  '所属泵站',
  '购置日期',
  '保养周期',
  '上次保养日',
  '保养到期日',
]

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  if (key === DRAINAGE_KEY) {
    const lines = [['编号', ...DRAINAGE_EXPORT_FIELDS, '当前状态'].join(',')]
    for (const view of deviceViews()) {
      lines.push(
        [
          view.id,
          ...DRAINAGE_EXPORT_FIELDS.map((field) => view[field as keyof MaintenanceViewEntry] ?? ''),
          view.状态,
        ].join(','),
      )
    }
    return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
  }
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  ensureBackfilled()
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = meta.key === DRAINAGE_KEY ? deviceViews().map(toEntryRow) : rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: meta.key === DRAINAGE_KEY
        ? entries.filter((row) => row.abnormal).length
        : entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
