<template>
  <section class="page" data-module="cctvinspect">
    <header class="page-head">
      <div>
        <h2>管道内窥检测管理</h2>
        <p class="page-desc">维护内窥检测记录，围绕检测编号、检测管段、缺陷等级、缺陷位置做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记内窥检测记录</button>
        <button class="btn" type="button" @click="runSeed">
          {{ seedFailed ? '重试一键播种' : '一键播种演示数据' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出管道内窥检测清单</button>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无管道内窥检测数据，可先登记内窥检测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管道内窥检测记录</span>
      <span v-if="seedMessage" class="seed-text">{{ seedMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detail" class="dialog-mask" @click.self="closeDetail">
      <div class="dialog" role="dialog" aria-label="内窥检测记录详情">
        <header class="dialog-head">
          <h3>内窥检测记录详情</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="dialog-body">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detail[column] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
        </dl>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  seedDemoData,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cctvinspect')
const columns = ["检测编号", "检测管段", "缺陷等级", "缺陷位置", "检测设备", "检测人", "检测日期", "检测状态"]
const actions = ["提交检测", "确认评定", "要求复检"]
const statuses = ["待检测", "检测中", "已评定", "需复检"]

const rows = ref<EntryRow[]>([])
const moduleRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const seedMessage = ref('')
const seedFailed = ref(false)
const detail = ref<EntryRow | null>(null)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const stats = computed(() => [
  { label: '待检测管段', value: countByStatus('待检测') },
  { label: '检测中管段', value: countByStatus('检测中') },
  { label: '需复检管段', value: countByStatus('需复检') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function countByStatus(status: string): number {
  return moduleRows.value.filter((row) => String(row.status) === status).length
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '内窥检测记录登记入口尚未接入审批流'
}

// 详情不做状态拦截：还停在「待检测」的记录也能直接打开。
function openDetail(row: EntryRow) {
  detail.value = getEntry(meta.key, Number(row.id)) ?? row
}

function closeDetail() {
  detail.value = null
}

function runSeed() {
  errorMessage.value = ''
  seedMessage.value = ''
  const result = seedDemoData()
  if (!result.ok) {
    seedFailed.value = true
    errorMessage.value = result.message
    return
  }
  seedFailed.value = false
  seedMessage.value = `${result.message}：${meta.name}共 ${result.total} 条，待处理 ${result.pending} 条`
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    moduleRows.value = listEntries(meta.key).items
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管道内窥检测列表读取失败'
  }
}

onMounted(reload)
</script>
