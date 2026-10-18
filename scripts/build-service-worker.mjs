/** Vite 构建后生成与该次产物对应的完整应用壳预缓存，不依赖额外打包插件。 */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = path.join(root, 'frontend/dist')
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))
  return nested.flat()
}
const assets = (await Promise.all(['assets', 'icons'].map(directory => walk(path.join(dist, directory))))).flat()
  .filter(file => !file.endsWith('.map'))
  .map(file => '/' + path.relative(dist, file).split(path.sep).join('/')).sort()
const source = await readFile(path.join(root, 'public/sw.js'), 'utf8')
const defaults = JSON.parse(source.match(/const PRECACHE = (\[[^\n]+\])/)[1].replaceAll("'", '"'))
const resources = [...new Set([...defaults, ...assets])]
const hash = createHash('sha256')
hash.update(source)
for (const resource of resources) {
  hash.update(resource)
  hash.update(await readFile(path.join(dist, resource === '/' ? 'index.html' : resource.slice(1))))
}
const sw = source.replace("const VERSION = 'shell-dev'", `const VERSION = '${hash.digest('hex').slice(0, 16)}'`)
  .replace(/const PRECACHE = \[[^\n]+\]/, `const PRECACHE = ${JSON.stringify(resources)}`)
await writeFile(path.join(dist, 'sw.js'), sw)
