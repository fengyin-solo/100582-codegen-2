<template>
  <section class="page" data-module="restock">
    <header class="page-head">
      <div>
        <h2>补库管理</h2>
        <p class="page-desc">补库单只往一个方向走：申报 → 审批 → 到货 → 验收。审批通过才允许登记到货，登记到货才允许验收；验收办结后库位安全库存跟着变。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleCreate">申报补库单</button>
        <button class="btn" type="button" @click="exportRows">导出补库清单</button>
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

    <form v-if="showCreate" class="panel" @submit.prevent="submitCreate">
      <h3 class="panel-title">申报补库单（同一采购单号重复提交只保留最新一版）</h3>
      <div class="panel-grid">
        <label class="filter-item">
          <span>采购单号</span>
          <input v-model="createForm.采购单号" placeholder="如 PO-2026-0005" />
        </label>
        <label class="filter-item">
          <span>物资名称</span>
          <input v-model="createForm.物资名称" placeholder="如 潜水排污泵" />
        </label>
        <label class="filter-item">
          <span>库位</span>
          <input v-model="createForm.库位" placeholder="如 一号物资库-A区" />
        </label>
        <label class="filter-item">
          <span>补库数量</span>
          <input v-model="createForm.补库数量" type="number" min="1" placeholder="申报数量" />
        </label>
        <label class="filter-item">
          <span>预计到货日期</span>
          <input v-model="createForm.预计到货日期" type="date" />
        </label>
        <label class="filter-item">
          <span>申报人</span>
          <input v-model="createForm.申报人" />
        </label>
      </div>
      <div class="panel-actions">
        <button class="btn primary" type="submit">提交申报</button>
        <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
      </div>
    </form>

    <form v-if="panel" class="panel" @submit.prevent="confirmPanel">
      <h3 class="panel-title">{{ panelTitle }}：{{ panel.row.采购单号 }}（{{ panel.row.物资名称 }}）</h3>
      <div class="panel-grid">
        <template v-if="panel.mode !== 'accept'">
          <label class="filter-item">
            <span>实际到货日期</span>
            <input v-model="panel.实际到货日期" type="date" />
          </label>
          <label class="filter-item">
            <span>实际到货数量</span>
            <input v-model="panel.实际到货数量" type="number" min="1" placeholder="现场实到数量" />
          </label>
        </template>
        <label v-if="panel.mode === 'accept'" class="filter-item">
          <span>验收人</span>
          <input v-model="panel.验收人" placeholder="现场验收单签字人" />
        </label>
      </div>
      <p class="panel-hint">缺到货日期或验收人的单子会卡在门上，退回原因里写清缺哪一格。</p>
      <div class="panel-actions">
        <button class="btn primary" type="submit">确认{{ panelTitle }}</button>
        <button class="btn ghost" type="button" @click="panel = null">取消</button>
      </div>
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
          <td v-for="column in columns" :key="column">{{ row[column] === '' || row[column] === undefined ? '—' : row[column] }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button v-if="row.status === '已申报'" class="link" type="button" @click="approve(row)">审批通过</button>
            <button v-if="row.status === '已审批'" class="link" type="button" @click="openPanel('arrival', row)">登记到货</button>
            <button v-if="row.status === '已到货'" class="link" type="button" @click="openPanel('update', row)">补录到货</button>
            <button v-if="row.status === '已到货'" class="link" type="button" @click="openPanel('accept', row)">验收办结</button>
            <span v-if="row.status === '已验收'" class="locked-text">已办结锁定</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无补库单数据，可先申报补库单</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">库位安全库存（验收办结后自动联动）</h3>
    <table class="data-table">
      <thead>
        <tr><th>库位</th><th>物资名称</th><th>安全库存</th><th>最近验收单号</th><th>更新时间</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in stockRows" :key="String(row.id)">
          <td>{{ row.库位 }}</td>
          <td>{{ row.物资名称 }}</td>
          <td>{{ row.安全库存 }}</td>
          <td>{{ row.最近验收单号 || '—' }}</td>
          <td>{{ row.更新时间 }}</td>
        </tr>
        <tr v-if="!stockRows.length">
          <td colspan="5" class="empty-state">暂无库位安全库存台账</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条补库单记录</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  RESTOCK_KEY,
  RESTOCK_STATUSES,
  acceptRestock,
  approveRestock,
  listRestock,
  listStock,
  registerArrival,
  submitRestock,
  updateArrival,
} from '@/api/restock-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const columns = ["采购单号", "物资名称", "库位", "补库数量", "预计到货日期", "实际到货日期", "实际到货数量", "差异数量", "验收人", "退回原因"]
const filterFields = ["采购单号", "物资名称", "库位"]

const rows = ref<EntryRow[]>([])
const stockRows = ref<EntryRow[]>([])
const filters = ref<Record<string, string>>({})
const okMessage = ref('')
const errorMessage = ref('')

const showCreate = ref(false)
const createForm = ref({ 采购单号: '', 物资名称: '', 库位: '', 补库数量: '', 预计到货日期: '', 申报人: store.operator })

type PanelMode = 'arrival' | 'update' | 'accept'
const panel = ref<{
  mode: PanelMode
  row: EntryRow
  实际到货日期: string
  实际到货数量: string
  验收人: string
} | null>(null)

const panelTitles: Record<PanelMode, string> = {
  arrival: '登记到货',
  update: '补录到货',
  accept: '验收办结',
}
const panelTitle = computed(() => (panel.value ? panelTitles[panel.value.mode] : ''))

const stats = computed(() => [
  { label: '待审批补库单', value: countByStatus('已申报') },
  { label: '待到货补库单', value: countByStatus('已审批') },
  { label: '待验收补库单', value: countByStatus('已到货') },
  { label: '已验收补库单', value: countByStatus('已验收') },
])

const statusSummary = computed(() =>
  RESTOCK_STATUSES.map((status) => ({
    status,
    count: countByStatus(status),
  })),
)

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function toggleCreate() {
  showCreate.value = !showCreate.value
  panel.value = null
}

function openPanel(mode: PanelMode, row: EntryRow) {
  showCreate.value = false
  panel.value = {
    mode,
    row,
    实际到货日期: String(row.实际到货日期 ?? ''),
    实际到货数量: row.实际到货数量 === '' || row.实际到货数量 === undefined ? '' : String(row.实际到货数量),
    验收人: String(row.验收人 ?? '') || store.operator,
  }
}

function submitCreate() {
  const result = submitRestock(createForm.value)
  report(result.ok, result.message)
  if (result.ok) {
    createForm.value = { 采购单号: '', 物资名称: '', 库位: '', 补库数量: '', 预计到货日期: '', 申报人: store.operator }
    showCreate.value = false
    reload()
  }
}

function approve(row: EntryRow) {
  const result = approveRestock(Number(row.id), store.operator)
  report(result.ok, result.message)
  reload()
}

function confirmPanel() {
  if (!panel.value) {
    return
  }
  const { mode, row } = panel.value
  const result = mode === 'accept'
    ? acceptRestock(Number(row.id), panel.value.验收人)
    : mode === 'arrival'
      ? registerArrival(Number(row.id), { 实际到货日期: panel.value.实际到货日期, 实际到货数量: panel.value.实际到货数量 })
      : updateArrival(Number(row.id), { 实际到货日期: panel.value.实际到货日期, 实际到货数量: panel.value.实际到货数量 })
  report(result.ok, result.message)
  if (result.ok) {
    panel.value = null
  }
  reload()
}

function report(ok: boolean, message: string) {
  okMessage.value = ok ? message : ''
  errorMessage.value = ok ? '' : message
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(RESTOCK_KEY)
}

function reload() {
  rows.value = listRestock(filters.value)
  stockRows.value = listStock()
}

onMounted(reload)
</script>
