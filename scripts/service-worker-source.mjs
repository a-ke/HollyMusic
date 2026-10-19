import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

/** 只编译无运行时依赖的协议模块；无需为 classic SW 新增打包器或改变注册方式。 */
export async function loadServiceWorkerSource(projectRoot) {
  const protocol = await readFile(path.join(projectRoot, 'lib/playback-protocol.ts'), 'utf8')
  const compiled = ts.transpileModule(protocol, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: 'playback-protocol.ts', reportDiagnostics: true,
  })
  const errors = compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? []
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => projectRoot, getCanonicalFileName: name => name, getNewLine: () => '\n',
  }))
  const source = await readFile(path.join(projectRoot, 'public/sw.js'), 'utf8')
  return `;(function () {\nconst exports = {};\n${compiled.outputText}\nself.__HOLLY_PLAYBACK_PROTOCOL__ = exports.playbackProtocol;\n})();\n${source}`
}
