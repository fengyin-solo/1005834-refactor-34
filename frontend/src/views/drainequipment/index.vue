<template>
  <section class="page" data-module="drainequipment">
    <header class="page-head">
      <div>
        <h2>排水设备台账管理</h2>
        <p class="page-desc">设备编号是唯一入口；保养到期日由统一算法按「上次保养日 + 保养周期」推算，台账、详情与概览同源。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记排水设备</button>
        <button class="btn" type="button" @click="runBackfillOnce">重新执行历史回填</button>
        <button class="btn" type="button" @click="exportRows">导出排水设备台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">保养已逾期：{{ overdueCount }}</span>
    </p>

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
          <td v-for="column in columns" :key="column">
            <RouterLink v-if="column === '设备编号'" class="link" :to="`/drainequipment/${row.id}`">
              {{ row[column] ?? '—' }}
            </RouterLink>
            <template v-else>
              <span v-if="column === '保养到期日' && isOverdue(row)" class="error-text">{{ row[column] }}</span>
              <span v-else>{{ row[column] || '—' }}</span>
            </template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <RouterLink class="link" :to="`/drainequipment/${row.id}`">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无排水设备台账数据，可先登记排水设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 台排水设备（重复编号只入账第一条）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="backfillMessage" class="ok-text">{{ backfillMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记排水设备</h3>
        <label v-for="field in createFields" :key="field" class="filter-item">
          <span>{{ field }}<em v-if="field === '设备编号' || field === '设备名称'">*</em></span>
          <input v-model="draft[field]" :placeholder="field === '保养周期' ? '如 90天 / 3个月，留空按 90 天' : `请输入${field}`" />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="submit">保存</button>
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createEquipment,
  downloadEntries,
  listEntries,
  maintenanceOverview,
  moduleMeta,
  runAction as applyAction,
  runBackfill,
} from '@/api/local-service'
import type { BackfillResult, EntryRow } from '@/data/types'

const meta = moduleMeta('drainequipment')
// 保养到期日是推算结果，由统一读口回填到行里，列里不再展示冗余的「设备状态」字段。
const columns = ['设备编号', '设备名称', '设备型号', '所属泵站', '购置日期', '保养周期', '上次保养日', '保养到期日']
const actions = ['登记运行', '完成保养', '报废设备']
const statuses = ['待保养', '运行中', '已保养', '已报废']
const createFields = ['设备编号', '设备名称', '设备型号', '所属泵站', '购置日期', '保养周期']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const backfillMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const creating = ref(false)
const draft = reactive<Record<string, string>>({})

const stats = ref([
  { label: '运行中设备', value: 0 },
  { label: '待保养设备', value: 0 },
  { label: '保养逾期设备', value: 0 },
  { label: '已报废设备', value: 0 },
])

const overdueCount = computed(() =>
  rows.value.filter((row) => isOverdue(row)).length,
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isOverdue(row: EntryRow): boolean {
  return Boolean(row.abnormal)
}

function refreshStats() {
  const summary = maintenanceOverview()
  stats.value = [
    { label: '运行中设备', value: rows.value.filter((row) => row.status === '运行中').length },
    { label: '待保养设备', value: summary.pendingMaint },
    { label: '保养逾期设备', value: summary.overdue },
    { label: '已报废设备', value: summary.scrapped },
  ]
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = ''
  for (const field of createFields) {
    draft[field] = ''
  }
  creating.value = true
}

function submitCreate() {
  errorMessage.value = ''
  const result = createEquipment({
    设备编号: draft['设备编号'] ?? '',
    设备名称: draft['设备名称'] ?? '',
    设备型号: draft['设备型号'] ?? '',
    所属泵站: draft['所属泵站'] ?? '',
    购置日期: draft['购置日期'] ?? '',
    保养周期: draft['保养周期'] ?? '',
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  creating.value = false
  backfillMessage.value = result.message
  reload()
}

function describeBackfill(result: BackfillResult): string {
  if (result.updated === 0 && result.duplicated === 0) {
    return '历史设备均已按新算法算过，本次回填未改动任何设备'
  }
  const parts = [`回填 ${result.updated} 台设备`]
  if (result.duplicated > 0) {
    parts.push(`识别重复编号 ${result.duplicated} 条（只入账第一条）`)
  }
  if (result.historyConflicts.length > 0) {
    parts.push(`${result.historyConflicts.length} 台按最近一次保养日修正`)
  }
  return parts.join('，')
}

function runBackfillOnce() {
  errorMessage.value = ''
  const result = runBackfill()
  backfillMessage.value = describeBackfill(result)
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  backfillMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  backfillMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排水设备台账列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.ok-text { color: #067647; }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 420px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-card h3 { margin: 0 0 4px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
em { color: #b42318; font-style: normal; }
</style>
