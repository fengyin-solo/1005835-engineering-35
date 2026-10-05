<template>
  <section class="page" data-module="cctvinspect">
    <header class="page-head">
      <div>
        <h2>管道内窥检测管理</h2>
        <p class="page-desc">维护内窥检测记录，围绕检测编号、检测管段、缺陷等级、缺陷位置做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="seeding" @click="seedDemo">
          {{ seeding ? '正在播种…' : '一键播种演示数据' }}
        </button>
        <button class="btn" type="button" @click="openCreate">登记内窥检测记录</button>
        <button class="btn" type="button" @click="exportRows">导出管道内窥检测清单</button>
      </div>
    </header>

    <p v-if="notice" class="notice" :class="noticeKind" :role="noticeKind === 'error' ? 'alert' : 'status'">
      <span>{{ notice }}</span>
      <button v-if="noticeKind === 'error'" class="link" type="button" @click="seedDemo">重试</button>
    </p>

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
          <td v-for="column in columns" :key="column">
            <button
              v-if="column === detailField"
              class="link"
              type="button"
              @click="openDetail(row)"
            >
              {{ row[column] ?? '—' }}
            </button>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">打开详情</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无管道内窥检测数据，可点上方「一键播种演示数据」</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管道内窥检测记录，其中待检测 {{ pendingCount }} 条（与概览看板一致）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detail" class="modal-mask" role="dialog" aria-modal="true" @click.self="closeDetail">
      <div class="modal-card">
        <header class="modal-head">
          <h3>内窥检测记录详情 · {{ detail.row[detailField] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <p v-if="isPending(detail.row)" class="notice info">
          该记录当前为「待检测」，可直接打开检测：全库待检测共 {{ detail.pendingTotal }} 条，与检测清单、概览看板读数一致。
        </p>
        <dl class="detail-grid">
          <div v-for="column in columns" :key="column" class="detail-item">
            <dt>{{ column }}</dt>
            <dd>{{ detail.row[column] ?? '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>当前状态</dt>
            <dd>{{ detail.row.status }}</dd>
          </div>
        </dl>
        <footer class="modal-foot">
          <span v-if="isPending(detail.row)" class="muted">状态停留在「待检测」的记录不阻塞查看，可随时打开。</span>
          <button class="btn primary" type="button" @click="closeDetail">知道了</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  seedCctvDemo,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cctvinspect')
const columns = ["检测编号", "检测管段", "缺陷等级", "缺陷位置", "检测设备", "检测人", "检测日期", "检测状态"]
const detailField = '检测编号'
const actions = ["提交检测", "确认评定", "要求复检"]
const statuses = ["待检测", "检测中", "已评定", "需复检"]

// allRowsData 永远是未筛选的全量数据：统计卡片、状态图例、详情里的待检测数都从它算，
// 筛选条件只通过 rows 这个计算属性作用于表格，三处读数因此始终一致。
const allRowsData = ref<EntryRow[]>([])
const rows = computed(() => filterRows(allRowsData.value, filters.value))
const total = computed(() => rows.value.length)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const seeding = ref(false)
const notice = ref('')
const noticeKind = ref<'success' | 'error'>('success')
const detail = ref<{ row: EntryRow; pendingTotal: number } | null>(null)

function countByStatus(status: string): number {
  return allRowsData.value.filter((row) => String(row.status) === status).length
}

// 统计卡片与状态图例都从同一份全量数据实时计算，不再写死为 0。
const stats = computed(() => [
  { label: '待检测管段', value: countByStatus('待检测') },
  { label: '检测中管段', value: countByStatus('检测中') },
  { label: '需复检管段', value: countByStatus('需复检') },
])
const pendingCount = computed(() => countByStatus('待检测'))
const statusSummary = computed(() =>
  statuses.map((status: string) => ({ status, count: countByStatus(status) })),
)

function isPending(row: EntryRow): boolean {
  return String(row.status) === '待检测'
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

function openDetail(row: EntryRow) {
  // 重新从数据层取一次，保证详情与清单是同一份存储里的最新值。
  const latest = getEntry(meta.key, Number(row.id))
  detail.value = latest ? { row: latest, pendingTotal: pendingCount.value } : null
}

function closeDetail() {
  detail.value = null
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

function seedDemo() {
  seeding.value = true
  errorMessage.value = ''
  try {
    const result = seedCctvDemo()
    notice.value = result.message
    noticeKind.value = 'success'
    filters.value = {}
    reload()
    if (detail.value) {
      const latest = getEntry(meta.key, Number(detail.value.row.id))
      detail.value = latest ? { row: latest, pendingTotal: result.pending } : null
    }
  } catch (error) {
    notice.value = `演示数据播种失败：${error instanceof Error ? error.message : '浏览器存储写入失败'}，本次未写入任何数据，可点「重试」再跑一次（不会产生重复记录）`
    noticeKind.value = 'error'
  } finally {
    seeding.value = false
  }
}

function reload() {
  errorMessage.value = ''
  try {
    // 统计与表格共用同一份全量数据，筛选交给计算属性，避免三处待检测数对不上。
    const payload = listEntries(meta.key)
    allRowsData.value = payload.items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管道内窥检测列表读取失败'
  }
}

onMounted(reload)
</script>
