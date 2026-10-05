import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  EQUIPMENT_KEY,
  assertForwardTransition,
  backfillEquipmentMaintenance,
  completeEquipmentMaintenance,
  equipmentDetailByCode,
  equipmentOverview,
  equipmentRowsWithSchedule,
  registerEquipment,
} from '@/domain/maintenance'
import type {
  ActionResult,
  EntryRow,
  MaintenanceOverview,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RegisterEquipmentInput,
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

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  if (key === EQUIPMENT_KEY) {
    // 读台账时先把存量按统一算法回填（幂等，已算过的不再动），
    // 列表行附上的「保养到期日」与详情页、概览是同一份推算结果。
    backfillEquipmentMaintenance()
    const pairs = equipmentRowsWithSchedule()
    const rows = pairs.map(({ row, schedule }) => ({ ...row, 保养到期日: schedule.dueDate }))
    const matched = filterRows(rows, filters)
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  }
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }

  // 排水设备的「完成保养」要登记保养记录并重算到期日，走专属实现。
  if (key === EQUIPMENT_KEY && action === '完成保养') {
    return completeEquipmentMaintenance(id)
  }

  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  // 设备状态单向推进：禁止从后一个状态回退到前一个状态。
  const blocked = assertForwardTransition(meta.statuses, current, target, meta.entity)
  if (blocked) {
    return blocked
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 排水设备台账的「设备状态」字段与当前状态保持同源，避免两处状态再对不上。
  if (key === EQUIPMENT_KEY) {
    updated['设备状态'] = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const fields = key === EQUIPMENT_KEY ? [...meta.fields, '保养到期日'] : meta.fields
  const header = ['编号', ...fields, '当前状态']
  const lines = [header.join(',')]
  const exportRows = key === EQUIPMENT_KEY ? listEntries(key).items : listRows(key)
  for (const row of exportRows) {
    lines.push([row.id, ...fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
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

// ---------- 排水设备保养：详情、登记、回填都走统一算法 ----------

export function getEquipmentDetail(code: string) {
  backfillEquipmentMaintenance()
  return equipmentDetailByCode(code)
}

export function registerDrainEquipment(input: RegisterEquipmentInput): ActionResult {
  return registerEquipment(input)
}

export function runMaintenanceBackfill() {
  return backfillEquipmentMaintenance()
}

export function loadMaintenanceOverview(): MaintenanceOverview {
  backfillEquipmentMaintenance()
  return equipmentOverview()
}
