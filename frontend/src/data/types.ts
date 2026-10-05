/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 一条历史保养记录：回填时与台账上的「上次保养日」核对，以最近一次为准。 */
export type MaintenanceRecord = {
  id: number
  equipmentCode: string
  maintenanceDate: string
  source: string
}

/** 保养到期推算结果。台账列表页、详情页、概览共用这一份结构，只由统一算法实时算出，不落地。 */
export type EquipmentSchedule = {
  /** 设备编号：保养推算的唯一入口 */
  equipmentCode: string
  /** 统一规则解析后的保养周期（天） */
  cycleDays: number
  /** 推算所采用的最近一次保养日（YYYY-MM-DD），拿不到保养记录时回落到购置日期 */
  basisDate: string
  basisSource: '保养记录' | '台账上次保养日' | '购置日期'
  /** 推算基准 = 最近一次保养日；没有保养记录时回落到购置日期 */
  baseDate: string
  /** 到期日 = 推算基准 + 保养周期 */
  dueDate: string
  overdue: boolean
  daysToDue: number
}

/** 设备台账详情：行数据与统一算法的推算结果始终成对出现。 */
export type EquipmentDetail = {
  row: EntryRow
  schedule: EquipmentSchedule
  records: MaintenanceRecord[]
}

/** 概览页保养板块读取的也是同一份推算结果。 */
export type MaintenanceOverview = {
  total: number
  overdue: number
  dueSoon: number
  maintained: number
  scrapped: number
  items: {
    equipmentCode: string
    equipmentName: string
    station: string
    status: string
    dueDate: string
    daysToDue: number
    overdue: boolean
  }[]
}

/** 回填结果报告。回填可反复执行，已按新算法算过的设备不再变动，因此重复执行各项均为 0。 */
export type BackfillReport = {
  scanned: number
  backfilled: number
  duplicatesMerged: number
  conflictsResolved: number
  unchanged: number
}

export type RegisterEquipmentInput = {
  equipmentCode: string
  equipmentName: string
  equipmentModel: string
  station: string
  purchaseDate: string
  cycleText: string
  lastMaintenanceDate?: string
}
