/** 生成独立保存的冬青候选稿：node scripts/gen-holly-logo.mjs。 */
import sharp from 'sharp'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const brandDir = path.join(root, 'public/brand')
const geometry = JSON.parse(await readFile(path.join(root, 'components/brand/holly-geometry.json'), 'utf8'))
const { green, berry, cream } = geometry.colors

function mark(ink = green, { compact = false, monochrome = false } = {}) {
  const circle = geometry.berry
  return `<path d="${geometry.outline}${compact ? '' : geometry.vein}" fill="${ink}" fill-rule="evenodd"/><circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}" fill="${monochrome ? ink : berry}"/>`
}

function wordmark(ink = green) {
  return `<g fill="${ink}">${geometry.wordmark.paths.map(glyph => `<path d="${glyph.d}" transform="${glyph.transform}"/>`).join('')}</g>`
}

function svg(viewBox, body, title = 'HollyMusic · 冬青音符') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}">\n  <title>${title}</title>\n  ${body}\n</svg>\n`
}

function tile({ compact = false, maskable = false } = {}) {
  // maskable 的所有识别元素均落在以画布中心为圆心、半径 40% 的安全区。
  const transform = maskable ? 'translate(15 20) scale(.7)' : 'translate(7 12) scale(.82)'
  return svg(geometry.viewBox, `<rect width="128" height="128"${maskable ? '' : ' rx="28"'} fill="${green}"/><g transform="${transform}">${mark(cream, { compact })}</g>`)
}

await mkdir(brandDir, { recursive: true })

const assets = {
  'holly-mark.svg': svg(geometry.viewBox, mark()),
  'holly-mark-small.svg': svg(geometry.viewBox, mark(green, { compact: true })),
  'holly-mark-light.svg': svg(geometry.viewBox, mark(cream)),
  'holly-mark-mono.svg': svg(geometry.viewBox, mark(green, { monochrome: true })),
  'holly-mark-mono-light.svg': svg(geometry.viewBox, mark(cream, { monochrome: true })),
  'holly-app.svg': tile(),
  'holly-app-maskable.svg': tile({ maskable: true }),
  'holly-favicon.svg': tile({ compact: true }),
}

for (const [suffix, ink] of [['', green], ['-light', cream]]) {
  assets[`holly-wordmark${suffix}.svg`] = svg(geometry.wordmark.viewBox, wordmark(ink), 'hollymusic')
  assets[`holly-horizontal${suffix}.svg`] = svg('0 0 484 128', `${mark(ink)}<g transform="translate(150 24)">${wordmark(ink)}</g>`)
  assets[`holly-stacked${suffix}.svg`] = svg('0 0 360 292', `<g transform="translate(77 8) scale(1.5)">${mark(ink)}</g><g transform="translate(21 214)">${wordmark(ink)}</g>`)
}

for (const [filename, source] of Object.entries(assets)) await writeFile(path.join(brandDir, filename), source)

// ICO 中写入 16/32/48px 三个 PNG 图层；各尺寸均使用无叶脉的紧凑图形。
const faviconSizes = [16, 32, 48]
const layers = await Promise.all(faviconSizes.map(size => sharp(Buffer.from(assets['holly-favicon.svg'])).resize(size).png().toBuffer()))
const header = Buffer.alloc(6 + 16 * layers.length)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(layers.length, 4)
let offset = header.length
layers.forEach((png, index) => {
  const entry = 6 + index * 16
  header[entry] = faviconSizes[index]
  header[entry + 1] = faviconSizes[index]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(png.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += png.length
})
const favicon = Buffer.concat([header, ...layers])
await writeFile(path.join(brandDir, 'holly-favicon.ico'), favicon)
process.stdout.write(`已在 public/brand/ 生成 ${Object.keys(assets).length} 个候选 SVG 和多尺寸 favicon。\n`)
