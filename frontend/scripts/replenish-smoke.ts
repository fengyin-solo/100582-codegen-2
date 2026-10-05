// 冒烟测试：在 node 里跑补库服务的全部业务规则（仓库无测试框架，用 esbuild 打包后执行）。
// 用法：npx esbuild scripts/replenish-smoke.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/replenish-smoke.mjs && node /tmp/replenish-smoke.mjs
const store = new Map<string, string>()
// @ts-ignore
globalThis.window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
  },
}

import {
  acceptOrder,
  approveOrder,
  createOrder,
  listOrders,
  listStockRows,
  registerArrival,
} from '@/api/replenish-service'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`ok  - ${name}`)
  } else {
    failures += 1
    console.log(`FAIL- ${name}`, extra ?? '')
  }
}

const draft = {
  poNo: 'PO-TEST-001', itemName: '防汛沙袋', location: '一号库A区',
  qty: 100, unit: '条', expectDate: '2026-10-20', applicant: '测试员',
}

// 1. 缺格子申报被退回，并写清缺哪一格
const r1 = createOrder({ ...draft, poNo: '  ', qty: 0 })
check('申报缺采购单号/补库数量被退回', !r1.ok && r1.message.includes('「采购单号」') && r1.message.includes('「补库数量」'), r1.message)

// 2. 正常申报
const r2 = createOrder(draft)
check('正常申报成功', r2.ok, r2.message)
const id1 = listOrders().find((r) => r['采购单号'] === 'PO-TEST-001')!.id as number

// 3. 重复提交同一采购单号，只保留最新一版
createOrder({ ...draft, qty: 120 })
const dup = listOrders().filter((r) => r['采购单号'] === 'PO-TEST-001')
check('重复提交只保留一版', dup.length === 1 && dup[0]['补库数量'] === 120 && dup[0]['版本'] === 2, dup)
const id = dup[0].id as number

// 4. 越级登记到货：未审批不许到货
const r4 = registerArrival(id, '2026-10-21', 120)
check('未审批不许登记到货', !r4.ok && r4.message.includes('审批通过才允许登记到货'), r4.message)

// 5. 越级验收：未到货不许验收
const r5 = acceptOrder(id, '赵敏', 120)
check('未登记到货不许验收', !r5.ok && r5.message.includes('登记到货才允许验收'), r5.message)

// 6. 审批缺审批人被退回
const r6 = approveOrder(id, '  ')
check('审批缺审批人被退回', !r6.ok && r6.message.includes('「审批人」'), r6.message)

// 7. 审批通过
check('审批通过', approveOrder(id, '陈静').ok)

// 8. 审批后不能再审批（不许回退/重复）
const r8 = approveOrder(id, '陈静')
check('重复审批被拒（只进不退）', !r8.ok && r8.message.includes('只进不退'), r8.message)

// 9. 到货缺日期被退回，写清缺哪格
const r9 = registerArrival(id, '', 120)
check('到货缺日期被退回', !r9.ok && r9.message.includes('「实际到货日期」'), r9.message)

// 10. 登记到货
check('登记到货成功', registerArrival(id, '2026-10-21', 118).ok)

// 11. 验收缺验收人被退回
const r11 = acceptOrder(id, ' ', 118)
check('验收缺验收人被退回', !r11.ok && r11.message.includes('「验收人」'), r11.message)

// 12. 验收办结：差异挂单下，申报数不覆盖
const stockBefore = listStockRows().find((r) => r['物资名称'] === '防汛沙袋' && r['存放库位'] === '一号库A区')!
const r12 = acceptOrder(id, '赵敏', 110)
check('验收办结', r12.ok, r12.message)
const done = listOrders().find((r) => r.id === id)!
check('差异挂在单下', done['差异数量'] === -10 && done['补库数量'] === 120 && done['验收数量'] === 110, done)
check('差异单标异常', done.abnormal === true && done.pending === false)

// 13. 验收后安全库存跟着变
const stockAfter = listStockRows().find((r) => r['物资名称'] === '防汛沙袋' && r['存放库位'] === '一号库A区')!
check(
  '验收后安全库存/当前库存同步上调',
  Number(stockAfter['安全库存']) === Number(stockBefore['安全库存']) + 110 &&
    Number(stockAfter['当前库存']) === Number(stockBefore['当前库存']) + 110 &&
    stockAfter['最近验收单号'] === 'PO-TEST-001',
  { before: stockBefore, after: stockAfter },
)

// 14. 已验收的单子不许再动到货数量
const r14 = registerArrival(id, '2026-10-22', 999)
check('验收后到货数量锁定', !r14.ok && r14.message.includes('锁定'), r14.message)

// 15. 已验收不许再验收
check('验收后不许重复验收', !acceptOrder(id, '赵敏', 110).ok)

// 16. 账实相符不标异常
createOrder({ ...draft, poNo: 'PO-TEST-002', itemName: '新物资X', location: '九号库Z区' })
const id2 = listOrders().find((r) => r['采购单号'] === 'PO-TEST-002')!.id as number
approveOrder(id2, '陈静')
registerArrival(id2, '2026-10-22', 100)
acceptOrder(id2, '赵敏', 100)
const done2 = listOrders().find((r) => r.id === id2)!
check('账实相符不标异常', done2.abnormal === false && done2['差异数量'] === 0)
check('新库位自动建档', listStockRows().some((r) => r['物资名称'] === '新物资X' && r['安全库存'] === 100))

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
