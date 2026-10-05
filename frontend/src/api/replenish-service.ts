import { filterRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 补库流程只许往前走：待审批 → 已审批 → 已到货 → 已验收。
// 验收办结是终点：状态不再动，到货数量也不许再改。
export const ORDER_KEY = 'replenish'
export const STOCK_KEY = 'replenishstock'

const FLOW = ['待审批', '已审批', '已到货', '已验收'] as const
const FINAL_STATUS = FLOW[FLOW.length - 1]

export type ReplenishDraft = {
  poNo: string
  itemName: string
  location: string
  qty: number
  unit: string
  expectDate: string
  applicant: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function orderRows(): EntryRow[] {
  return [...listRows(ORDER_KEY)]
}

function findOrder(id: number): { rows: EntryRow[]; index: number } | null {
  const rows = orderRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? null : { rows, index }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function missingText(fields: string[]): string {
  return fields.map((field) => `「${field}」`).join('')
}

export function listOrders(filters: Record<string, string> = {}): EntryRow[] {
  return filterRows(listRows(ORDER_KEY), filters)
}

export function listStockRows(): EntryRow[] {
  return listRows(STOCK_KEY)
}

export function createOrder(draft: ReplenishDraft): ActionResult {
  const poNo = draft.poNo.trim()
  const missing: string[] = []
  if (!poNo) missing.push('采购单号')
  if (!draft.itemName.trim()) missing.push('物资名称')
  if (!draft.location.trim()) missing.push('存放库位')
  if (!Number.isFinite(draft.qty) || draft.qty <= 0) missing.push('补库数量')
  if (!draft.unit.trim()) missing.push('计量单位')
  if (!draft.expectDate) missing.push('预计到货日期')
  if (!draft.applicant.trim()) missing.push('申报人')
  if (missing.length > 0) {
    return { ok: false, message: `申报退回：缺${missingText(missing)}，补齐后再报` }
  }
  const rows = orderRows()
  // 同一采购单号重复提交只保留最新一版：旧版撤下，版本号接着往后排。
  const oldVersions = rows
    .filter((row) => String(row['采购单号']) === poNo)
    .map((row) => Number(row['版本']) || 0)
  const version = oldVersions.length > 0 ? Math.max(...oldVersions) + 1 : 1
  const kept = rows.filter((row) => String(row['采购单号']) !== poNo)
  const row: EntryRow = {
    id: nextId(rows),
    status: FLOW[0],
    pending: true,
    abnormal: false,
    采购单号: poNo,
    物资名称: draft.itemName.trim(),
    存放库位: draft.location.trim(),
    补库数量: draft.qty,
    计量单位: draft.unit.trim(),
    预计到货日期: draft.expectDate,
    申报人: draft.applicant.trim(),
    审批人: '',
    实际到货日期: '',
    实际到货数量: '',
    验收人: '',
    验收数量: '',
    差异数量: '',
    版本: version,
  }
  saveRows(ORDER_KEY, [...kept, row])
  if (oldVersions.length > 0) {
    return { ok: true, message: `采购单号 ${poNo} 已申报过，旧版已撤下，只保留最新第 ${version} 版` }
  }
  return { ok: true, message: `补库单 ${poNo} 已申报，当前状态「${FLOW[0]}」` }
}

export function approveOrder(id: number, approver: string): ActionResult {
  const found = findOrder(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的补库单` }
  }
  const { rows, index } = found
  const row = rows[index]
  const status = String(row.status)
  if (status !== FLOW[0]) {
    return { ok: false, message: `流程只进不退：只有「${FLOW[0]}」的单子能审批，当前状态「${status}」` }
  }
  if (!approver.trim()) {
    return { ok: false, message: '审批退回：缺「审批人」，补齐后再报' }
  }
  rows[index] = { ...row, status: FLOW[1], 审批人: approver.trim(), pending: true }
  saveRows(ORDER_KEY, rows)
  return { ok: true, message: `补库单 ${row['采购单号']} 审批通过，可以登记到货` }
}

export function registerArrival(id: number, arrivalDate: string, arrivalQty: number): ActionResult {
  const found = findOrder(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的补库单` }
  }
  const { rows, index } = found
  const row = rows[index]
  const status = String(row.status)
  if (status === FINAL_STATUS) {
    return { ok: false, message: `补库单 ${row['采购单号']} 已验收办结，到货数量锁定，不许再改` }
  }
  if (status !== FLOW[1]) {
    return { ok: false, message: `审批通过才允许登记到货，当前状态「${status}」` }
  }
  const missing: string[] = []
  if (!arrivalDate) missing.push('实际到货日期')
  if (!Number.isFinite(arrivalQty) || arrivalQty <= 0) missing.push('实际到货数量')
  if (missing.length > 0) {
    return { ok: false, message: `到货登记退回：缺${missingText(missing)}，补齐后再报` }
  }
  rows[index] = { ...row, status: FLOW[2], 实际到货日期: arrivalDate, 实际到货数量: arrivalQty, pending: true }
  saveRows(ORDER_KEY, rows)
  return { ok: true, message: `补库单 ${row['采购单号']} 已登记到货 ${arrivalQty} ${row['计量单位']}，可以验收` }
}

export function acceptOrder(id: number, inspector: string, acceptQty: number): ActionResult {
  const found = findOrder(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的补库单` }
  }
  const { rows, index } = found
  const row = rows[index]
  const status = String(row.status)
  if (status === FINAL_STATUS) {
    return { ok: false, message: `补库单 ${row['采购单号']} 已验收办结，不允许重复验收` }
  }
  if (status !== FLOW[2]) {
    return { ok: false, message: `登记到货才允许验收，当前状态「${status}」` }
  }
  // 验收这扇门卡两格：到货日期、验收人，缺哪一格退哪一格，退回时写清楚。
  const missing: string[] = []
  if (!String(row['实际到货日期'] ?? '').trim()) missing.push('实际到货日期')
  if (!inspector.trim()) missing.push('验收人')
  if (!Number.isFinite(acceptQty) || acceptQty < 0) missing.push('验收数量')
  if (missing.length > 0) {
    return { ok: false, message: `验收退回：缺${missingText(missing)}，单子卡在验收门口，补齐后再报` }
  }
  const declared = Number(row['补库数量']) || 0
  // 以现场验收单为准：差异挂在单子下面，原来的申报数保持不动。
  const diff = acceptQty - declared
  rows[index] = {
    ...row,
    status: FINAL_STATUS,
    pending: false,
    abnormal: diff !== 0,
    验收人: inspector.trim(),
    验收数量: acceptQty,
    差异数量: diff,
  }
  saveRows(ORDER_KEY, rows)
  applyStock(String(row['物资名称']), String(row['存放库位']), acceptQty, String(row['采购单号']))
  const diffNote = diff === 0 ? '账实相符' : `差异 ${diff > 0 ? '+' : ''}${diff} 已挂在单下，申报数 ${declared} 保持不变`
  return { ok: true, message: `补库单 ${row['采购单号']} 验收办结，${diffNote}；库位安全库存已同步` }
}

// 验收办结后，物资库位的当前库存与安全库存跟着验收数量一起上调。
function applyStock(itemName: string, location: string, acceptQty: number, poNo: string): void {
  const rows = [...listRows(STOCK_KEY)]
  const index = rows.findIndex(
    (row) => String(row['物资名称']) === itemName && String(row['存放库位']) === location,
  )
  if (index >= 0) {
    const row = rows[index]
    rows[index] = {
      ...row,
      当前库存: (Number(row['当前库存']) || 0) + acceptQty,
      安全库存: (Number(row['安全库存']) || 0) + acceptQty,
      最近验收单号: poNo,
      最近验收日期: today(),
    }
  } else {
    rows.push({
      id: nextId(rows),
      status: '在管',
      pending: false,
      abnormal: false,
      物资名称: itemName,
      存放库位: location,
      当前库存: acceptQty,
      安全库存: acceptQty,
      最近验收单号: poNo,
      最近验收日期: today(),
    })
  }
  saveRows(STOCK_KEY, rows)
}
