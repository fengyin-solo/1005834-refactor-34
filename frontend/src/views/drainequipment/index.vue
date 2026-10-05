<template>
  <section class="page" data-module="drainequipment">
    <header class="page-head">
      <div>
        <h2>排水设备台账管理</h2>
        <p class="page-desc">设备编号是唯一入口；保养到期日由统一算法推算，台账、详情、概览同源。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">登记排水设备</button>
        <button class="btn" type="button" @click="runBackfill">按新算法回填</button>
        <button class="btn" type="button" @click="exportRows">导出排水设备台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="item.danger ? 'due-overdue' : ''">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showForm" class="register-form" @submit.prevent="submitRegister">
      <label v-for="field in formFields" :key="field.prop" class="filter-item">
        <span>{{ field.label }}<em v-if="field.required">*</em></span>
        <input v-model="form[field.prop]" :placeholder="field.placeholder" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="showForm = false">取消</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td
            v-for="column in columns"
            :key="column"
            :class="column === '保养到期日' && isOverdue(row) ? 'due-overdue' : ''"
          >
            {{ row[column] ?? '—' }}
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无排水设备台账数据，可先登记排水设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条排水设备台账记录（同编号重复登记只入账一条）</span>
      <span v-if="message" :class="messageTone">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  loadMaintenanceOverview,
  moduleMeta,
  registerDrainEquipment,
  runAction as applyAction,
  runMaintenanceBackfill,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const router = useRouter()
const meta = moduleMeta('drainequipment')
const columns = ['设备编号', '设备名称', '设备型号', '所属泵站', '购置日期', '保养周期', '上次保养日', '保养到期日']
const actions = ['登记运行', '完成保养', '报废设备']
const statuses = ['待保养', '运行中', '已保养', '已报废']

const formFields = [
  { prop: 'equipmentCode', label: '设备编号', required: true, placeholder: '如 DRAI-0009' },
  { prop: 'equipmentName', label: '设备名称', required: true, placeholder: '如 潜水排污泵' },
  { prop: 'equipmentModel', label: '设备型号', required: false, placeholder: '如 WQ-200' },
  { prop: 'station', label: '所属泵站', required: false, placeholder: '如 城东一站' },
  { prop: 'purchaseDate', label: '购置日期', required: true, placeholder: 'YYYY-MM-DD' },
  { prop: 'cycleText', label: '保养周期', required: true, placeholder: '如 90天 / 3个月 / 季度 / 半年' },
  { prop: 'lastMaintenanceDate', label: '上次保养日', required: false, placeholder: '选填，YYYY-MM-DD' },
] as const

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageTone = ref('')
const filters = ref<Record<string, string>>({})
const showForm = ref(false)
const form = reactive<Record<string, string>>({})
const filterFields = ['设备编号', '设备名称', '设备型号']
const overdueCodes = ref<Set<string>>(new Set())

const stats = computed(() => {
  const overview = loadMaintenanceOverview()
  return [
    { label: '在册设备', value: overview.total, danger: false },
    { label: '已逾期未保养', value: overview.overdue, danger: true },
    { label: '30天内临期', value: overview.dueSoon, danger: false },
    { label: '已报废设备', value: overview.scrapped, danger: false },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isOverdue(row: EntryRow): boolean {
  return overdueCodes.value.has(String(row['设备编号'] ?? ''))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openDetail(row: EntryRow) {
  router.push({ name: 'drainequipment-detail', query: { code: String(row['设备编号'] ?? '') } })
}

function submitRegister() {
  const result = registerDrainEquipment({
    equipmentCode: form.equipmentCode ?? '',
    equipmentName: form.equipmentName ?? '',
    equipmentModel: form.equipmentModel ?? '',
    station: form.station ?? '',
    purchaseDate: form.purchaseDate ?? '',
    cycleText: form.cycleText ?? '',
    lastMaintenanceDate: form.lastMaintenanceDate || undefined,
  })
  message.value = result.message
  messageTone.value = result.ok ? 'success-text' : 'error-text'
  if (result.ok) {
    showForm.value = false
    Object.keys(form).forEach((key) => {
      form[key] = ''
    })
    reload()
  }
}

function runBackfill() {
  const report = runMaintenanceBackfill()
  message.value = report.backfilled === 0 && report.duplicatesMerged === 0
    ? '回填完成：所有设备均已按新算法计算，无变动（可反复执行，不会写重）'
    : `回填完成：新回填 ${report.backfilled} 台，合并重复编号 ${report.duplicatesMerged} 条，按最近保养日纠正冲突 ${report.conflictsResolved} 处`
  messageTone.value = 'success-text'
  reload()
}

function runAction(action: string, row: EntryRow) {
  message.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  message.value = result.message
  messageTone.value = result.ok ? 'success-text' : 'error-text'
  if (result.ok) {
    reload()
  }
}

function reload() {
  message.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    overdueCodes.value = new Set(
      loadMaintenanceOverview()
        .items.filter((item) => item.overdue)
        .map((item) => item.equipmentCode),
    )
  } catch (error) {
    message.value = error instanceof Error ? error.message : '排水设备台账列表读取失败'
    messageTone.value = 'error-text'
  }
}

onMounted(reload)
</script>

<style scoped>
.due-overdue {
  color: #b42318;
  font-weight: 600;
}
.success-text {
  color: #067647;
}
.register-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 12px;
}
.register-form em {
  color: #b42318;
  font-style: normal;
  margin-left: 2px;
}
</style>
