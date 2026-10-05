/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 保养到期日回填版本戳：已经按新算法算过的设备带这个戳，回填不再改动。 */
  __maintVersion?: string
  [field: string]: string | number | boolean | undefined
}

/** 排水设备的历史保养记录，按设备编号挂到台账设备上。 */
export type MaintenanceHistoryRecord = {
  id: number
  设备编号: string
  保养日期: string
  保养内容: string
  保养人: string
}

/** 保养到期日唯一读口对外吐出的设备视图，列表页、详情页、概览共用。 */
export type MaintenanceViewEntry = {
  id: number
  设备编号: string
  设备名称: string
  设备型号: string
  所属泵站: string
  购置日期: string
  保养周期: string
  上次保养日: string
  保养到期日: string
  状态: string
  逾期: boolean
  即将到期: boolean
}

export type MaintConflict = {
  设备编号: string
  台账上次保养日: string
  最近保养日: string
}

export type BackfillResult = {
  ran: boolean
  alreadyStamped: boolean
  updated: number
  duplicated: number
  skipped: number
  historyConflicts: MaintConflict[]
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
