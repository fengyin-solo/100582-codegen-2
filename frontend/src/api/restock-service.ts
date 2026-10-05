import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 补库单只认一个方向：申报 → 审批 → 到货 → 验收。这里的每个动作都只把单子往前推，
// 没有任何入口能把状态往回退；已验收的单子到货数量直接锁死。
export const RESTOCK_KEY = 'restock'
export const STOCK_KEY = 'restockstock'

export const RESTOCK_STATUSES = ['已申报', '已审批', '已到货', '已验收'] as const

const DECLARED_FIELD = '补库数量'
const ARRIVAL_DATE_FIELD = '实际到货日期'
const ARRIVAL_QTY_FIELD = '实际到货数量'
const ACCEPTOR_FIELD = '验收人'
const RETURN_REASON_FIELD = '退回原因'

export type RestockSubmit = {
  采购单号: string
  物资名称: string
  库位: string
  补库数量: string
  预计到货日期: string
  申报人: string
}

export type ArrivalInput = {
  实际到货日期: string
  实际到货数量: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

function findOrder(rows: EntryRow[], id: number): { row: EntryRow; index: number } | null {
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? null : { row: rows[index], index }
}

function missingCells(row: EntryRow, fields: string[]): string[] {
  return fields.filter((field) => String(row[field] ?? '').trim() === '')
}

// 卡在门上的单子：把缺哪一格写进「退回原因」，标成异常，状态原地不动。
function holdAtGate(rows: EntryRow[], index: number, missing: string[]): ActionResult {
  const reason = `缺${missing.join('、')}`
  const next = [...rows]
  next[index] = { ...rows[index], [RETURN_REASON_FIELD]: reason, abnormal: true }
  saveRows(RESTOCK_KEY, next)
  return { ok: false, message: `单子被退回：${reason}，补齐对应格后重新提交` }
}

export function listRestock(filters: Record<string, string> = {}): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const rows = listRows(RESTOCK_KEY)
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listStock(): EntryRow[] {
  return listRows(STOCK_KEY)
}

// 申报：同一个采购单号重复提交时，旧版整条作废，只保留最新提交的这一版。
export function submitRestock(input: RestockSubmit): ActionResult {
  const required: [keyof RestockSubmit, string][] = [
    ['采购单号', '采购单号'],
    ['物资名称', '物资名称'],
    ['库位', '库位'],
    ['补库数量', '补库数量'],
    ['预计到货日期', '预计到货日期'],
    ['申报人', '申报人'],
  ]
  const missing = required.filter(([key]) => input[key].trim() === '').map(([, label]) => label)
  if (missing.length > 0) {
    return { ok: false, message: `申报缺【${missing.join('、')}】，补齐后才能提交` }
  }
  const qty = Number(input.补库数量)
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, message: '补库数量必须是大于 0 的数字' }
  }
  const rows = listRows(RESTOCK_KEY)
  const kept = rows.filter((row) => String(row.采购单号) !== input.采购单号.trim())
  const replaced = rows.length - kept.length
  const order: EntryRow = {
    id: nextId(rows),
    status: '已申报',
    pending: true,
    abnormal: false,
    采购单号: input.采购单号.trim(),
    物资名称: input.物资名称.trim(),
    库位: input.库位.trim(),
    [DECLARED_FIELD]: qty,
    预计到货日期: input.预计到货日期.trim(),
    [ARRIVAL_DATE_FIELD]: '',
    [ARRIVAL_QTY_FIELD]: '',
    差异数量: '',
    申报人: input.申报人.trim(),
    审批人: '',
    [ACCEPTOR_FIELD]: '',
    验收时间: '',
    [RETURN_REASON_FIELD]: '',
  }
  saveRows(RESTOCK_KEY, [...kept, order])
  const message = replaced > 0
    ? `采购单号 ${order.采购单号} 已提交过 ${replaced} 版，已只保留最新一版，状态回到「已申报」`
    : `补库单 ${order.采购单号} 已申报，等待审批`
  return { ok: true, message }
}

// 审批：只有「已申报」的单子能进审批，过了审批才允许登记到货。
export function approveRestock(id: number, approver: string): ActionResult {
  const rows = listRows(RESTOCK_KEY)
  const found = findOrder(rows, id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的补库单` }
  }
  if (String(found.row.status) !== '已申报') {
    return { ok: false, message: `只有「已申报」的单子才能审批，当前状态「${found.row.status}」，流程不许往回退` }
  }
  if (approver.trim() === '') {
    return holdAtGate(rows, found.index, ['审批人'])
  }
  const next = [...rows]
  next[found.index] = { ...found.row, status: '已审批', 审批人: approver.trim(), [RETURN_REASON_FIELD]: '', abnormal: false }
  saveRows(RESTOCK_KEY, next)
  return { ok: true, message: `补库单 ${found.row.采购单号} 审批通过，可以登记到货` }
}

// 登记到货：必须先审批通过；缺到货日期或到货数量就卡在门上，退回原因写清缺哪一格。
export function registerArrival(id: number, input: ArrivalInput): ActionResult {
  const rows = listRows(RESTOCK_KEY)
  const found = findOrder(rows, id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的补库单` }
  }
  const status = String(found.row.status)
  if (status === '已申报') {
    return { ok: false, message: '审批通过才允许登记到货，这张单子还没过审批' }
  }
  if (status !== '已审批') {
    return { ok: false, message: `当前状态「${status}」，不能重复登记到货` }
  }
  return applyArrival(rows, found.index, input, '已到货', '到货已登记，可以安排验收')
}

// 补录到货：到货后、验收前可以更正到货信息；已验收的单子到货数量不许再动。
export function updateArrival(id: number, input: ArrivalInput): ActionResult {
  const rows = listRows(RESTOCK_KEY)
  const found = findOrder(rows, id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的补库单` }
  }
  const status = String(found.row.status)
  if (status === '已验收') {
    return { ok: false, message: '单子已验收办结，到货数量不许再动' }
  }
  if (status !== '已到货') {
    return { ok: false, message: `只有「已到货」的单子才能补录到货信息，当前状态「${status}」` }
  }
  return applyArrival(rows, found.index, input, '已到货', '到货信息已补录')
}

function applyArrival(
  rows: EntryRow[],
  index: number,
  input: ArrivalInput,
  targetStatus: string,
  okMessage: string,
): ActionResult {
  const draft: EntryRow = {
    ...rows[index],
    [ARRIVAL_DATE_FIELD]: input.实际到货日期.trim(),
    [ARRIVAL_QTY_FIELD]: input.实际到货数量.trim(),
  }
  const missing = missingCells(draft, [ARRIVAL_DATE_FIELD, ARRIVAL_QTY_FIELD])
  if (missing.length > 0) {
    return holdAtGate(rows, index, missing)
  }
  const qty = Number(input.实际到货数量)
  if (!Number.isFinite(qty) || qty <= 0) {
    return holdAtGate(rows, index, ['有效的实际到货数量'])
  }
  const next = [...rows]
  next[index] = {
    ...draft,
    [ARRIVAL_QTY_FIELD]: qty,
    status: targetStatus,
    [RETURN_REASON_FIELD]: '',
    abnormal: false,
  }
  saveRows(RESTOCK_KEY, next)
  return { ok: true, message: okMessage }
}

// 验收办结：必须先登记到货；缺到货日期或验收人卡在门上。
// 补库数量与实物到货对不上时以现场验收数为准，差异挂在该单下面，不覆盖申报数；
// 办结之后，该库位的安全库存跟着实到数量变。
export function acceptRestock(id: number, acceptor: string): ActionResult {
  const rows = listRows(RESTOCK_KEY)
  const found = findOrder(rows, id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的补库单` }
  }
  const status = String(found.row.status)
  if (status === '已申报' || status === '已审批') {
    return { ok: false, message: '登记到货才允许验收，这张单子还没登记到货' }
  }
  if (status === '已验收') {
    return { ok: false, message: '单子已验收办结，不能重复验收' }
  }
  const draft: EntryRow = { ...found.row, [ACCEPTOR_FIELD]: acceptor.trim() }
  const missing = missingCells(draft, [ARRIVAL_DATE_FIELD, ARRIVAL_QTY_FIELD, ACCEPTOR_FIELD])
  if (missing.length > 0) {
    return holdAtGate(rows, found.index, missing)
  }
  const declared = Number(draft[DECLARED_FIELD])
  const arrived = Number(draft[ARRIVAL_QTY_FIELD])
  const diff = arrived - declared
  const acceptedAt = today()
  const next = [...rows]
  next[found.index] = {
    ...draft,
    status: '已验收',
    pending: false,
    abnormal: false,
    差异数量: diff,
    验收时间: acceptedAt,
    [RETURN_REASON_FIELD]: '',
  }
  saveRows(RESTOCK_KEY, next)
  const stockMessage = bumpStock(String(draft.库位), String(draft.物资名称), arrived, String(draft.采购单号), acceptedAt)
  const diffMessage = diff === 0
    ? '实到与申报一致'
    : `差异 ${diff} 已挂在该单下面，申报数 ${declared} 不改动`
  return { ok: true, message: `补库单 ${draft.采购单号} 验收办结：${diffMessage}；${stockMessage}` }
}

// 验收办结后联动库位安全库存：按现场验收的实到数量累加，库位没有台账就新建一条。
function bumpStock(location: string, material: string, arrived: number, orderNo: string, at: string): string {
  const rows = listRows(STOCK_KEY)
  const index = rows.findIndex(
    (row) => String(row.库位) === location && String(row.物资名称) === material,
  )
  if (index < 0) {
    const created: EntryRow = {
      id: nextId(rows),
      status: '在库',
      pending: false,
      abnormal: false,
      库位: location,
      物资名称: material,
      安全库存: arrived,
      最近验收单号: orderNo,
      更新时间: at,
    }
    saveRows(STOCK_KEY, [...rows, created])
    return `库位「${location}」新建安全库存台账，安全库存 0 → ${arrived}`
  }
  const before = Number(rows[index].安全库存) || 0
  const after = before + arrived
  const next = [...rows]
  next[index] = { ...rows[index], 安全库存: after, 最近验收单号: orderNo, 更新时间: at }
  saveRows(STOCK_KEY, next)
  return `库位「${location}」安全库存 ${before} → ${after}`
}
