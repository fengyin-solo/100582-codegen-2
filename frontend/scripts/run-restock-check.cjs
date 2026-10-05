// 补库流程校验的运行器：用 TypeScript 编译器 API 在内存里转译 TS 并处理 @/ 别名。
// 用法：node scripts/run-restock-check.js
const path = require('path')
const fs = require('fs')
const Module = require('module')

const frontendDir = path.resolve(__dirname, '..')
const ts = require(path.join(frontendDir, 'node_modules', 'typescript'))
const srcDir = path.join(frontendDir, 'src')

require.extensions['.ts'] = function (mod, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  })
  mod._compile(outputText, filename)
}

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    request = path.join(srcDir, request.slice(2))
  }
  return origResolve.call(this, request, ...args)
}

require(path.join(frontendDir, 'scripts', 'restock-flow.check.ts'))
