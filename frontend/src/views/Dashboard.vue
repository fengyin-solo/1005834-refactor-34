<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <h2 class="section-title">排水设备保养到期</h2>
    <p class="page-desc">到期日与台账列表页、详情页是同一份推算结果：到期日 = 最近一次保养日 + 保养周期。</p>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在册设备</span>
        <strong class="stat-value">{{ maintenance.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已逾期未保养</span>
        <strong class="stat-value overdue">{{ maintenance.overdue }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">30天内临期</span>
        <strong class="stat-value">{{ maintenance.dueSoon }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已保养 / 已报废</span>
        <strong class="stat-value">{{ maintenance.maintained }} / {{ maintenance.scrapped }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>设备编号</th><th>设备名称</th><th>所属泵站</th><th>设备状态</th><th>保养到期日</th><th>距到期</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in maintenance.items" :key="item.equipmentCode">
          <td>
            <RouterLink class="link" :to="{ name: 'drainequipment-detail', query: { code: item.equipmentCode } }">
              {{ item.equipmentCode }}
            </RouterLink>
          </td>
          <td>{{ item.equipmentName }}</td>
          <td>{{ item.station }}</td>
          <td>{{ item.status }}</td>
          <td :class="{ overdue: item.overdue }">{{ item.dueDate }}</td>
          <td :class="{ overdue: item.overdue }">{{ dueLabel(item.daysToDue) }}</td>
        </tr>
        <tr v-if="!maintenance.items.length">
          <td colspan="6" class="empty-state">暂无排水设备台账数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadMaintenanceOverview, loadOverview } from '@/api/local-service'
import type { MaintenanceOverview, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const maintenance = ref<MaintenanceOverview>({
  total: 0,
  overdue: 0,
  dueSoon: 0,
  maintained: 0,
  scrapped: 0,
  items: [],
})

function dueLabel(daysToDue: number): string {
  if (daysToDue < 0) {
    return `已逾期 ${-daysToDue} 天`
  }
  if (daysToDue === 0) {
    return '今日到期'
  }
  return `还有 ${daysToDue} 天`
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  maintenance.value = loadMaintenanceOverview()
}

onMounted(refresh)
</script>

<style scoped>
.section-title {
  font-size: 17px;
  margin: 22px 0 4px;
}
.overdue {
  color: #b42318;
  font-weight: 600;
}
</style>
