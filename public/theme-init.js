/* 在样式表和 React 加载前应用外观，避免深色用户首次加载时闪白。
 * 偏好校验与 lib/store/appearance-store.ts 保持一致（有一致性回归测试）。 */
;(function () {
  var settings = {}
  try {
    var saved = JSON.parse(localStorage.getItem('holly-appearance') || 'null')
    if (saved && typeof saved === 'object') settings = saved
  } catch {
    // 禁用存储不影响首屏渲染。
  }
  var mode = settings.mode === 'light' || settings.mode === 'dark' ? settings.mode : 'system'
  var palette = settings.palette === 'blue' || settings.palette === 'apricot' ? settings.palette : 'forest'
  var dark = mode === 'dark' || (mode === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.palette = palette
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  // 浏览器/PWA 标题栏在 React 和样式表加载前也使用已保存的外观。
  var chromeColors = dark
    ? { forest: '#19251f', blue: '#1b242e', apricot: '#2c231c' }
    : { forest: '#f3f7f3', blue: '#f2f6fa', apricot: '#faf5ef' }
  var themeMeta = document.querySelector('meta[name="theme-color"]')
  if (themeMeta) themeMeta.content = chromeColors[palette]
})()
