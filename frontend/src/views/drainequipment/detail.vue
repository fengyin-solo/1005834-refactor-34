<template>
  <section class="page" data-module="drainequipment-detail">
    <header class="page-head">
      <div>
        <h2>排水设备保养详情</h2>
        <p class="page-desc">保养周期、最近一次保养日与到期日均由统一算法推算，与台账列表页、运营概览同源。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="{ name: 'drainequipment' }">返回台账列表</RouterLink>
      </div>
    </header>

    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <template v-else-if="detail">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">保养到期日</span>
          <strong class="stat-value" :class="{ 'due-overdue': detail.schedule.overdue }">
            {{ detail.schedule.dueDate }}
          </strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">距到期</span>
          <strong class="stat-value">{{ dueLabel }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">设备状态</span>
          <strong class="stat-value">{{ detail.row.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">保养周期</span>
          <strong class="stat-value">{{ detail.row['保养周期'] }}（{{ detail.schedule.cycleDays }}天）</strong>
        </article>
      </div>

      <h3>台账信息</h3>
      <table class="data-table detail-grid">
        <tbody>
          <tr v-for="field in infoFields" :key="field">
            <th>{{ field }}</th>
            <td>{{ detail.row[field] ?? '—' }}</td>
          </tr>
          <tr>
            <th>推算基准（最近一次保养日）</th>
            <td>
              {{ detail.schedule.basisDate }}
              <span class="basis-tag">取自：{{ detail.schedule.basisSource }}</span>
            </td>
          </tr>
          <tr>
            <th>保养到期日（= 推算基准 + 保养周期）</th>
            <td :class="{ 'due-overdue': detail.schedule.overdue }">{{ detail.schedule.dueDate }}</td>
          </tr>
        </tbody>
      </table>

      <h3>历史保养记录</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>设备编号</th>
            <th>保养日期</th>
            <th>来源单据</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(record, index) in detail.records" :key="record.id">
            <td>{{ index + 1 }}</td>
            <td>{{ record.equipmentCode }}</td>
            <td>{{ record.maintenanceDate }}</td>
            <td>{{ record.source }}</td>
          </tr>
          <tr v-if="!detail.records.length">
            <td colspan="4" class="empty-state">暂无历史保养记录，推算基准回落到购置日期</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getEquipmentDetail } from '@/api/local-service'
import type { EquipmentDetail } from '@/data/types'

const route = useRoute()
const detail = ref<EquipmentDetail | null>(null)
const errorMessage = ref('')

const infoFields = ['设备编号', '设备名称', '设备型号', '所属泵站', '购置日期', '保养周期', '上次保养日', '设备状态']

const dueLabel = computed(() => {
  if (!detail.value) {
    return '—'
  }
  const { daysToDue } = detail.value.schedule
  if (daysToDue < 0) {
    return `已逾期 ${-daysToDue} 天`
  }
  if (daysToDue === 0) {
    return '今日到期'
  }
  return `还有 ${daysToDue} 天`
})

function load() {
  errorMessage.value = ''
  detail.value = null
  const code = String(route.query.code ?? '')
  if (!code) {
    errorMessage.value = '缺少设备编号，无法查看详情'
    return
  }
  const payload = getEquipmentDetail(code)
  if (!payload) {
    errorMessage.value = `没有找到设备编号为 ${code} 的排水设备`
    return
  }
  detail.value = payload
}

watch(() => route.query.code, load, { immediate: true })
</script>

<style scoped>
.basis-tag {
  margin-left: 8px;
  font-size: 12px;
  color: var(--muted);
  background: #eef2f7;
  border-radius: 999px;
  padding: 1px 10px;
}
.detail-grid th {
  width: 240px;
}
.due-overdue {
  color: #b42318;
}
h3 {
  font-size: 15px;
  margin: 18px 0 8px;
}
</style>
