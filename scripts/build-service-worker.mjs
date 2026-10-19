/** Vite 构建后生成与该次产物对应的完整应用壳预缓存，不依赖额外打包插件。 */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const SHELL_RESOURCES = [
  '/', '/manifest.json', '/icon.svg', '/theme-init.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png',
]
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))
  return nested.flat()
}

export async function buildServiceWorker(projectRoot = root) {
  const dist = path.join(projectRoot, 'frontend/dist')
  const assets = (await Promise.all(['assets', 'icons'].map(directory => walk(path.join(dist, directory))))).flat()
    .filter(file => !file.endsWith('.map'))
    .map(file => '/' + path.relative(dist, file).split(path.sep).join('/'))
  const resources = [...new Set([...SHELL_RESOURCES, ...assets])].sort()
  const source = await readFile(path.join(projectRoot, 'public/sw.js'), 'utf8')
  const hash = createHash('sha256').update(source)
  for (const resource of resources) {
    hash.update(resource)
    // 必需资源缺失时构建失败，不发布不完整的离线应用壳。
    hash.update(await readFile(path.join(dist, resource === '/' ? 'index.html' : resource.slice(1))))
  }
  const config = { version: hash.digest('hex').slice(0, 16), precache: resources }
  // 配置独立于 Worker 源码，源码改引号、换行或变量排版都不影响注入。
  const sw = `self.__HOLLY_SW_BUILD__ = ${JSON.stringify(config)};\n${source}`
  new Script(sw, { filename: 'sw.js' })
  await writeFile(path.join(dist, 'sw.js'), sw)
  return config
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildServiceWorker()
