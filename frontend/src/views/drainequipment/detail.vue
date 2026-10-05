<template>
  <section class="page" data-module="drainequipment-detail">
    <header class="page-head">
      <div>
        <h2>排水设备详情</h2>
        <p class="page-desc">保养周期、上次保养日、保养到期日与台账列表、运营概览出自同一份推算结果。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/drainequipment">返回台账列表</RouterLink>
      </div>
    </header>

    <div v-if="!detail" class="empty-state">没有找到这台排水设备</div>

    <template v-else>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">保养到期日</span>
          <strong class="stat-value" :class="{ 'due-overdue': detail.view.逾期 }">{{ detail.view.保养到期日 || '—' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">距到期</span>
          <strong class="stat-value">{{ daysLabel }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ detail.view.状态 }}</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ viewRecord[field] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="block-title">历史保养记录</h3>
      <table class="data-table">
        <thead>
          <tr><th>保养日期</th><th>保养内容</th><th>保养人</th></tr>
        </thead>
        <tbody>
          <tr v-for="record in detail.history" :key="record.id">
            <td>{{ record.保养日期 }}</td>
            <td>{{ record.保养内容 }}</td>
            <td>{{ record.保养人 }}</td>
          </tr>
          <tr v-if="!detail.history.length">
            <td colspan="3" class="empty-state">暂无历史保养记录</td>
          </tr>
        </tbody>
      </table>

      <div class="row-actions detail-actions">
        <button
          v-for="action in actions"
          :key="action"
          class="btn"
          :class="{ primary: action === '完成保养' }"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
      </div>
      <footer class="page-foot">
        <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getEquipmentDetail, runAction as applyAction } from '@/api/local-service'
import { parseDate, todayString } from '@/data/maintenance'
import type { EquipmentDetail } from '@/api/local-service'

const route = useRoute()
const router = useRouter()
const actions = ['登记运行', '完成保养', '报废设备']
const fields = ['设备编号', '设备名称', '设备型号', '所属泵站', '购置日期', '保养周期', '上次保养日', '保养到期日']

const detail = ref<EquipmentDetail | null>(null)
const message = ref('')
const messageOk = ref(false)

const viewRecord = computed<Record<string, string>>(() => {
  const view = detail.value?.view
  if (!view) {
    return {}
  }
  return Object.fromEntries(fields.map((field) => [field, String(view[field as keyof typeof view] ?? '')]))
})

const daysLabel = computed(() => {
  const due = parseDate(detail.value?.view.保养到期日)
  if (!due) {
    return '—'
  }
  const today = parseDate(todayString()) as Date
  const days = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (days < 0) {
    return `已逾期 ${Math.abs(days)} 天`
  }
  if (days === 0) {
    return '今天到期'
  }
  return `还剩 ${days} 天`
})

function load() {
  const id = Number(route.params.id)
  detail.value = getEquipmentDetail(id)
}

function runAction(action: string) {
  message.value = ''
  const id = Number(route.params.id)
  const result = applyAction('drainequipment', id, action)
  messageOk.value = result.ok
  message.value = result.message
  if (!result.ok) {
    return
  }
  if (action === '报废设备') {
    router.push('/drainequipment')
    return
  }
  load()
}

onMounted(load())
</script>

<style scoped>
.detail-table th { width: 140px; }
.block-title { margin: 18px 0 8px; font-size: 15px; }
.detail-actions { margin-top: 14px; }
.due-overdue { color: #b42318; }
.ok-text { color: #067647; }
</style>
