/* eslint-disable */
// 统一算法验证脚本（Node 环境运行，由 scripts/tsconfig.test.json 转译为 CommonJS）。
import assert from 'assert'
import {
  parseCycleDays,
  backfillEquipmentMaintenance,
  canonicalEquipmentRows,
  equipmentDetailByCode,
  equipmentRowsWithSchedule,
  equipmentOverview,
  findEquipmentByCode,
  completeEquipmentMaintenance,
  registerEquipment,
  assertForwardTransition,
} from '../src/domain/maintenance'
import { listRows, saveRows } from '../src/data/local-store'
import { runAction } from '../src/api/local-service'

function makeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
}
;(globalThis as any).window = {
  localStorage: makeStorage(),
}

async function main() {
  // 1) 首次回填：冲突以最近一次保养日为准
  const report1 = backfillEquipmentMaintenance()
  assert.equal(report1.scanned, 3, '扫描 3 台')
  assert.equal(report1.backfilled, 3, '首次回填 3 台')
  assert.equal(report1.duplicatesMerged, 0)
  assert.equal(report1.conflictsResolved, 1, 'DRAI-0001 冲突 1 处')

  const d1 = findEquipmentByCode('DRAI-0001')!
  assert.equal(d1['上次保养日'], '2026-07-05', '冲突后取最近一次保养日')
  assert.equal(d1['保养周期'], '91天', '季度归一化为 91 天')

  // 三处口径一致：到期日 = 最近保养日 + 周期
  const listDue = equipmentRowsWithSchedule('2026-10-05').find((p) => p.row.id === 1)!.schedule.dueDate
  const detail = equipmentDetailByCode('DRAI-0001')!
  const ov = equipmentOverview('2026-10-05')
  const ov1 = ov.items.find((i) => i.equipmentCode === 'DRAI-0001')!
  assert.equal(listDue, '2026-10-04')
  assert.equal(detail.schedule.dueDate, '2026-10-04')
  assert.equal(ov1.dueDate, '2026-10-04')
  assert.equal(ov1.overdue, true)
  assert.equal(detail.schedule.basisSource, '保养记录')

  const ov2 = ov.items.find((i) => i.equipmentCode === 'DRAI-0002')!
  assert.equal(ov2.dueDate, '2026-08-28', '2026-03-01 + 180 天')
  assert.equal(ov2.overdue, true)

  const d3 = equipmentDetailByCode('DRAI-0003')!
  assert.equal(d3.schedule.baseDate, '2026-09-20')
  assert.equal(d3.schedule.basisSource, '台账上次保养日')
  assert.equal(d3.schedule.dueDate, '2027-03-21', '2026-09-20 + 182 天')

  // 2) 回填幂等
  const before = (globalThis as any).window.localStorage.getItem('drainage-pump:entries')
  const report2 = backfillEquipmentMaintenance()
  assert.equal(report2.backfilled, 0)
  assert.equal(report2.duplicatesMerged, 0)
  assert.equal(report2.conflictsResolved, 0)
  assert.equal((globalThis as any).window.localStorage.getItem('drainage-pump:entries'), before, '重复回填不落盘')
  const report3 = backfillEquipmentMaintenance()
  assert.equal(report3.unchanged, 3)
  assert.equal(findEquipmentByCode('DRAI-0001')!['上次保养日'], '2026-07-05', '算过的不再变动')

  // 3) 重复编号只入账一条
  const dirty = listRows('drainequipment')
  dirty.push({
    id: 99, status: '待保养', pending: true, abnormal: false,
    '设备编号': 'drai-0001',
    '设备名称': '重复登记设备', '设备型号': 'X', '所属泵站': 'X',
    '购置日期': '2026-01-01', '保养周期': '91天', '上次保养日': '2026-08-01',
    '设备状态': '待保养', __maintAlgo: 'maintenance-due-v1',
  })
  saveRows('drainequipment', dirty)
  const report4 = backfillEquipmentMaintenance()
  assert.equal(report4.scanned, 4)
  assert.equal(report4.duplicatesMerged, 1)
  assert.equal(report4.backfilled, 0, '已算过的 3 台不受影响')
  const merged = canonicalEquipmentRows().filter((r) => r['设备编号'] === 'DRAI-0001')
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 1, '保留最早入账的一条')
  assert.equal(merged[0]['上次保养日'], '2026-08-01', '被合并行更新的保养日并入')
  assert.equal(backfillEquipmentMaintenance().duplicatesMerged, 0, '重复合并不会写重')

  // 4) 重复登记被拒；新建设备即时按统一算法给出到期日
  assert.equal(
    registerEquipment({
      equipmentCode: 'drai-0001', equipmentName: '又登记一次', equipmentModel: '', station: '',
      purchaseDate: '2026-01-01', cycleText: '30天',
    }).ok,
    false,
  )
  assert.equal(
    registerEquipment({
      equipmentCode: 'DRAI-0010', equipmentName: '', equipmentModel: '', station: '',
      purchaseDate: '2026-09-01', cycleText: '30天',
    }).ok,
    false,
    '名称必填',
  )
  const addOk = registerEquipment({
    equipmentCode: 'DRAI-0010', equipmentName: '新泵', equipmentModel: 'M', station: 'S',
    purchaseDate: '2026-09-01', cycleText: '1个月', lastMaintenanceDate: '2026-09-15',
  })
  assert.equal(addOk.ok, true)
  const added = equipmentDetailByCode('DRAI-0010')!
  assert.equal(added.schedule.cycleDays, 30)
  assert.equal(added.schedule.dueDate, '2026-10-15')
  assert.equal(added.records.length, 1)
  assert.equal(
    registerEquipment({
      equipmentCode: 'DRAI-0011', equipmentName: '坏周期', equipmentModel: '', station: '',
      purchaseDate: '2026-09-01', cycleText: '说不清',
    }).ok,
    false,
  )

  // 5) 状态单向推进
  const id10 = findEquipmentByCode('DRAI-0010')!.id
  assert.equal(completeEquipmentMaintenance(id10).ok, true)
  assert.equal(findEquipmentByCode('DRAI-0010')!.status, '已保养')
  assert.equal(completeEquipmentMaintenance(id10).ok, false, '重复保养被拒')
  const backward = assertForwardTransition(['待保养', '运行中', '已保养', '已报废'], '已保养', '运行中', '排水设备')
  assert.equal(backward!.ok, false)
  assert.equal(
    assertForwardTransition(['待保养', '运行中', '已保养', '已报废'], '运行中', '已报废', '排水设备'),
    null,
    '报废是前进，放行',
  )
  // 完成保养后到期日随当日新记录重算
  const after = equipmentDetailByCode('DRAI-0010')!
  assert.equal(after.schedule.basisDate, after.records[0].maintenanceDate)
  assert.equal(after.schedule.dueDate, shift(after.schedule.basisDate, 30))

  // 6) 无保养记录回落到购置日期
  assert.equal(
    registerEquipment({
      equipmentCode: 'DRAI-0012', equipmentName: '无保养史', equipmentModel: '', station: '',
      purchaseDate: '2026-01-10', cycleText: '90天',
    }).ok,
    true,
  )
  const d12 = equipmentDetailByCode('DRAI-0012')!
  assert.equal(d12.schedule.basisSource, '购置日期')
  assert.equal(d12.schedule.dueDate, '2026-04-10')

  // 7) 报废设备不计逾期
  const id12 = findEquipmentByCode('DRAI-0012')!.id
  assert.equal(runAction('drainequipment', id12, '报废设备').ok, true)
  assert.equal(
    equipmentOverview('2026-10-05').items.find((i) => i.equipmentCode === 'DRAI-0012')!.overdue,
    false,
  )

  // 8) 周期解析唯一规则
  assert.equal(parseCycleDays('3个月'), 90)
  assert.equal(parseCycleDays('一年'), 365)
  assert.equal(parseCycleDays('2周'), 14)
  assert.equal(parseCycleDays('180天'), 180)
  assert.equal(parseCycleDays('垃圾值'), null)

  console.log('全部断言通过 ✔')
}

function shift(dateText: string, days: number): string {
  const d = new Date(`${dateText}T00:00:00`)
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
