<template>
  <section class="page" data-module="replenish">
    <header class="page-head">
      <div>
        <h2>补库管理</h2>
        <p class="page-desc">补库单只许往前走：申报、审批、到货、验收，不许回退；验收办结后到货数量锁定，差异挂在单下，库位安全库存同步更新。</p>
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

    <form v-if="createOpen" class="filter-bar create-bar" @submit.prevent="submitCreate">
      <label class="filter-item">
        <span>采购单号</span>
        <input v-model="draft.poNo" placeholder="如 PO-2026-1006" />
      </label>
      <label class="filter-item">
        <span>物资名称</span>
        <input v-model="draft.itemName" placeholder="如 防汛沙袋" />
      </label>
      <label class="filter-item">
        <span>存放库位</span>
        <input v-model="draft.location" placeholder="如 一号库A区" />
      </label>
      <label class="filter-item">
        <span>补库数量</span>
        <input v-model.number="draft.qty" type="number" min="1" />
      </label>
      <label class="filter-item">
        <span>计量单位</span>
        <input v-model="draft.unit" placeholder="条 / 台 / 件" />
      </label>
      <label class="filter-item">
        <span>预计到货日期</span>
        <input v-model="draft.expectDate" type="date" />
      </label>
      <label class="filter-item">
        <span>申报人</span>
        <input v-model="draft.applicant" />
      </label>
      <button class="btn primary" type="submit">提交申报</button>
      <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
      <span class="form-hint">同一采购单号重复提交，旧版自动撤下，只保留最新一版</span>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>采购单号</span>
        <input v-model="filters.采购单号" placeholder="按采购单号检索" />
      </label>
      <label class="filter-item">
        <span>物资名称</span>
        <input v-model="filters.物资名称" placeholder="按物资名称检索" />
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
        <template v-for="row in rows" :key="String(row.id)">
          <tr>
            <td v-for="column in columns" :key="column">
              <template v-if="column === '版本'">第{{ row[column] ?? 1 }}版</template>
              <template v-else-if="column === '差异数量'">
                <span :class="{ 'diff-text': hasDiff(row) }">{{ diffText(row) }}</span>
              </template>
              <template v-else>{{ row[column] === '' || row[column] === undefined ? '—' : row[column] }}</template>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in rowActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="openPanel(action, row)"
              >
                {{ action }}
              </button>
              <span v-if="rowActions(row).length === 0" class="locked-text">已办结·到货数量锁定</span>
            </td>
          </tr>
          <tr v-if="panelRowId === Number(row.id)" class="panel-row">
            <td :colspan="columns.length + 2">
              <form class="panel-form" @submit.prevent="submitPanel">
                <template v-if="panelAction === '审批通过'">
                  <label class="filter-item">
                    <span>审批人</span>
                    <input v-model="formApprover" placeholder="审批人姓名" />
                  </label>
                </template>
                <template v-else-if="panelAction === '登记到货'">
                  <label class="filter-item">
                    <span>实际到货日期</span>
                    <input v-model="formArrivalDate" type="date" />
                  </label>
                  <label class="filter-item">
                    <span>实际到货数量</span>
                    <input v-model.number="formArrivalQty" type="number" min="1" />
                  </label>
                </template>
                <template v-else-if="panelAction === '验收办结'">
                  <label class="filter-item">
                    <span>验收人</span>
                    <input v-model="formInspector" placeholder="验收人姓名" />
                  </label>
                  <label class="filter-item">
                    <span>验收数量（以现场验收单为准）</span>
                    <input v-model.number="formAcceptQty" type="number" min="0" />
                  </label>
                </template>
                <button class="btn primary" type="submit">确认{{ panelAction }}</button>
                <button class="btn ghost" type="button" @click="closePanel">取消</button>
              </form>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无补库单，可先申报补库单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 张补库单（同一采购单号只保留最新一版）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="notice" class="ok-text">{{ notice }}</span>
    </footer>

    <section class="stock-panel">
      <h3 class="panel-title">物资库位安全库存</h3>
      <p class="page-desc">验收办结后，对应库位的当前库存与安全库存按验收数量同步上调。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in stockColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in stockRows" :key="String(row.id)">
            <td v-for="column in stockColumns" :key="column">{{ row[column] ?? '—' }}</td>
          </tr>
          <tr v-if="!stockRows.length">
            <td :colspan="stockColumns.length" class="empty-state">暂无库位库存记录</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  acceptOrder,
  approveOrder,
  createOrder,
  listOrders,
  listStockRows,
  registerArrival,
  type ReplenishDraft,
} from '@/api/replenish-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('replenish')
const store = useSessionStore()

const columns = ["采购单号", "版本", "物资名称", "存放库位", "补库数量", "计量单位", "预计到货日期", "实际到货日期", "实际到货数量", "验收人", "验收数量", "差异数量"]
const stockColumns = ["物资名称", "存放库位", "当前库存", "安全库存", "最近验收单号", "最近验收日期"]
const statuses = meta.statuses

const ACTION_BY_STATUS: Record<string, string[]> = {
  待审批: ['审批通过'],
  已审批: ['登记到货'],
  已到货: ['验收办结'],
  已验收: [],
}

const rows = ref<EntryRow[]>([])
const stockRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({ 采购单号: '', 物资名称: '' })

const createOpen = ref(false)
const draft = ref<ReplenishDraft>({ poNo: '', itemName: '', location: '', qty: 0, unit: '', expectDate: '', applicant: '' })

const panelRowId = ref(0)
const panelAction = ref('')
const formApprover = ref('')
const formArrivalDate = ref('')
const formArrivalQty = ref(0)
const formInspector = ref('')
const formAcceptQty = ref(0)

const stats = computed(() => [
  { label: '待审批补库单', value: rows.value.filter((row) => row.status === '待审批').length },
  { label: '在途补库单', value: rows.value.filter((row) => row.status === '已审批' || row.status === '已到货').length },
  { label: '差异单数', value: rows.value.filter((row) => hasDiff(row)).length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function hasDiff(row: EntryRow): boolean {
  const raw = row['差异数量']
  return raw !== '' && raw !== undefined && Number(raw) !== 0
}

function diffText(row: EntryRow): string {
  const raw = row['差异数量']
  if (raw === '' || raw === undefined) return '—'
  const num = Number(raw)
  return num > 0 ? `+${num}` : String(num)
}

function rowActions(row: EntryRow): string[] {
  return ACTION_BY_STATUS[String(row.status)] ?? []
}

function toggleCreate() {
  createOpen.value = !createOpen.value
  errorMessage.value = ''
  if (createOpen.value) {
    draft.value = { poNo: '', itemName: '', location: '', qty: 0, unit: '', expectDate: '', applicant: store.operator }
  }
}

function submitCreate() {
  errorMessage.value = ''
  notice.value = ''
  const result = createOrder(draft.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  createOpen.value = false
  reload()
}

function openPanel(action: string, row: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  panelRowId.value = Number(row.id)
  panelAction.value = action
  if (action === '审批通过') {
    formApprover.value = store.operator
  } else if (action === '登记到货') {
    formArrivalDate.value = new Date().toISOString().slice(0, 10)
    formArrivalQty.value = Number(row['补库数量']) || 0
  } else if (action === '验收办结') {
    formInspector.value = store.operator
    formAcceptQty.value = Number(row['实际到货数量']) || Number(row['补库数量']) || 0
  }
}

function closePanel() {
  panelRowId.value = 0
  panelAction.value = ''
}

function submitPanel() {
  errorMessage.value = ''
  notice.value = ''
  const id = panelRowId.value
  const result =
    panelAction.value === '审批通过'
      ? approveOrder(id, formApprover.value)
      : panelAction.value === '登记到货'
        ? registerArrival(id, formArrivalDate.value, Number(formArrivalQty.value))
        : acceptOrder(id, formInspector.value, Number(formAcceptQty.value))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  closePanel()
  reload()
}

function resetFilters() {
  filters.value = { 采购单号: '', 物资名称: '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listOrders(filters.value)
    total.value = rows.value.length
    stockRows.value = [...listStockRows()]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '补库单列表读取失败'
  }
}

onMounted(reload)
</script>
