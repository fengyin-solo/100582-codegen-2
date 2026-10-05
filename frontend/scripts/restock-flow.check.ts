import {
  acceptRestock,
  approveRestock,
  listRestock,
  listStock,
  registerArrival,
  submitRestock,
  updateArrival,
} from '@/api/restock-service'

let failures = 0
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`ok   ${label}`)
  } else {
    failures += 1
    console.log(`FAIL ${label}`, extra ?? '')
  }
}

// 1. 申报 → 审批 → 到货 → 验收 全流程
const s1 = submitRestock({ 采购单号: 'PO-T-1', 物资名称: '潜水排污泵', 库位: '一号物资库-A区', 补库数量: '10', 预计到货日期: '2026-10-10', 申报人: '张三' })
check('申报成功', s1.ok, s1.message)
const id1 = Number(listRestock().find((r) => r.采购单号 === 'PO-T-1')!.id)

const earlyArrival = registerArrival(id1, { 实际到货日期: '2026-10-09', 实际到货数量: '10' })
check('未审批不能登记到货', !earlyArrival.ok, earlyArrival.message)

check('审批通过', approveRestock(id1, '李四').ok)

const noDate = registerArrival(id1, { 实际到货日期: '', 实际到货数量: '10' })
check('缺到货日期卡在门上', !noDate.ok && noDate.message.includes('缺实际到货日期'), noDate.message)
check('退回原因写进单子', String(listRestock().find((r) => Number(r.id) === id1)!.退回原因) === '缺实际到货日期')

check('补齐后登记到货成功', registerArrival(id1, { 实际到货日期: '2026-10-09', 实际到货数量: '8' }).ok)

const noAcceptor = acceptRestock(id1, '')
check('缺验收人卡在门上', !noAcceptor.ok && noAcceptor.message.includes('缺验收人'), noAcceptor.message)

const before = Number(listStock().find((r) => r.库位 === '一号物资库-A区' && r.物资名称 === '潜水排污泵')!.安全库存)
const acc = acceptRestock(id1, '王五')
check('验收办结', acc.ok, acc.message)
const done = listRestock().find((r) => Number(r.id) === id1)!
check('差异挂在单下', Number(done.差异数量) === -2, done.差异数量)
check('申报数不被覆盖', Number(done.补库数量) === 10, done.补库数量)
const after = Number(listStock().find((r) => r.库位 === '一号物资库-A区' && r.物资名称 === '潜水排污泵')!.安全库存)
check('安全库存跟着实到变', after - before === 8, `${before} -> ${after}`)

// 2. 已验收的单子不许再动到货数量
const locked = updateArrival(id1, { 实际到货日期: '2026-10-11', 实际到货数量: '99' })
check('已验收锁死到货数量', !locked.ok, locked.message)
check('到货数量没被动', Number(listRestock().find((r) => Number(r.id) === id1)!.实际到货数量) === 8)

// 3. 不能往回退 / 不能跳步
const s2 = submitRestock({ 采购单号: 'PO-T-2', 物资名称: '液位计', 库位: '一号物资库-B区', 补库数量: '5', 预计到货日期: '2026-10-15', 申报人: '张三' })
const id2 = Number(listRestock().find((r) => r.采购单号 === 'PO-T-2')!.id)
check('未到货不能验收', !acceptRestock(id2, '王五').ok)
check('重复审批被拒绝', !approveRestock(id1, '李四').ok)
void s2

// 4. 同一采购单号重复提交只保留最新一版
submitRestock({ 采购单号: 'PO-T-2', 物资名称: '液位计', 库位: '一号物资库-B区', 补库数量: '5', 预计到货日期: '2026-10-15', 申报人: '张三' })
const dup = submitRestock({ 采购单号: 'PO-T-2', 物资名称: '液位计', 库位: '一号物资库-B区', 补库数量: '7', 预计到货日期: '2026-10-16', 申报人: '张三' })
check('重复提交提示保留最新版', dup.ok && dup.message.includes('只保留最新一版'), dup.message)
const versions = listRestock().filter((r) => r.采购单号 === 'PO-T-2')
check('同一采购单号只剩一条', versions.length === 1, versions.length)
check('留下的是最新一版', Number(versions[0].补库数量) === 7 && versions[0].status === '已申报', versions[0])

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
