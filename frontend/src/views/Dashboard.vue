<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常；排水设备保养到期日取自统一推算，不再拿设备状态凑。</p>
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

    <h3 class="block-title">排水设备保养到期概览</h3>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">设备总数（去重后）</span>
        <strong class="stat-value">{{ maint.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已逾期</span>
        <strong class="stat-value due-overdue">{{ maint.overdue }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">30天内到期</span>
        <strong class="stat-value">{{ maint.dueSoon }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待保养</span>
        <strong class="stat-value">{{ maint.pendingMaint }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已报废</span>
        <strong class="stat-value">{{ maint.scrapped }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>设备编号</th><th>设备名称</th><th>所属泵站</th><th>上次保养日</th><th>保养到期日</th><th>到期判定</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in dueList" :key="String(item.id)">
          <td>
            <RouterLink class="link" :to="`/drainequipment/${item.id}`">{{ item.设备编号 }}</RouterLink>
          </td>
          <td>{{ item.设备名称 }}</td>
          <td>{{ item.所属泵站 }}</td>
          <td>{{ item.上次保养日 || '—' }}</td>
          <td :class="{ 'due-overdue': item.逾期 }">{{ item.保养到期日 || '—' }}</td>
          <td>{{ dueTag(item) }}</td>
        </tr>
        <tr v-if="!dueList.length">
          <td colspan="6" class="empty-state">近期没有需要保养的排水设备</td>
        </tr>
      </tbody>
    </table>

    <h3 class="block-title">全业务模块</h3>
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
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview, listEntries, maintenanceOverview } from '@/api/local-service'
import type { EntryRow, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const maint = ref(maintenanceOverview())
const dueList = ref<EntryRow[]>([])

// 概览与列表、详情同一读口：这里直接把统一推算结果按到期紧迫程度取前几条展示。
function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  maint.value = maintenanceOverview()
  dueList.value = listEntries('drainequipment').items
    .slice()
    .sort((a, b) => String(a.保养到期日 ?? '').localeCompare(String(b.保养到期日 ?? '')))
    .slice(0, 8)
}

function dueTag(row: EntryRow): string {
  if (row.abnormal) {
    return '已逾期'
  }
  return row.status === '已保养' ? '已保养' : '未到期'
}

onMounted(refresh)
</script>

<style scoped>
.block-title { margin: 18px 0 10px; font-size: 15px; }
.due-overdue { color: #b42318; }
</style>
