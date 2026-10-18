/** 原生 Chromium BiquadFilterNode 与 EQ 频响模型对照，无新增依赖。 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

if (typeof WebSocket === 'undefined') throw new Error('原生音频验证脚本需要 Node.js 22+（内置 WebSocket）。')

const chrome = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium')
const directory = mkdtempSync(join(tmpdir(), 'holly-eq-response-'))
try {
  const modules = ['equalizer', 'audio-param-smoother', 'equalizer-automation'].map(name => {
    const code = ts.transpileModule(readFileSync(fileURLToPath(new URL(`../lib/client/${name}.ts`, import.meta.url)), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText
    return `modules['./${name}'] = {}; ((exports, require) => { ${code} })(modules['./${name}'], id => modules[id]);`
  }).join('\n')
  const page = join(directory, 'test.html')
  writeFileSync(page, `<!doctype html><body>pending<script>const modules = {};\n${modules}\nconst exports = modules['./equalizer'];\n
    let worst = 0, cases = 0, centerError = 0;
    for (const rate of [22050, 32000, 44100, 48000, 96000]) {
      const ctx = new OfflineAudioContext(2, 128, rate);
      for (const preset of [...exports.EQ_PRESETS, { bands: Array(10).fill(12) }]) {
        const f = exports.responseFrequencies(rate);
        const design = exports.designEqualizer(preset.bands, rate);
        centerError = Math.max(centerError, design.maxError);
        const predicted = exports.equalizerResponse(design.gains, rate, f);
        const actual = new Float64Array(f.length);
        for (let i = 0; i < 10; i++) {
          const node = ctx.createBiquadFilter();
          node.type = 'peaking'; node.frequency.value = exports.filterFrequency(exports.EQ_FREQUENCIES[i], rate);
          node.Q.value = exports.filterQ(i, rate); node.gain.value = design.gains[i];
          const magnitude = new Float32Array(f.length), phase = new Float32Array(f.length);
          node.getFrequencyResponse(f, magnitude, phase);
          for (let j = 0; j < f.length; j++) actual[j] += 20 * Math.log10(magnitude[j]);
        }
        for (let j = 0; j < f.length; j++) worst = Math.max(worst, Math.abs(actual[j] - predicted[j]));
        cases++;
      }
    }
    const report = { passed: worst < 0.0001 && centerError < 0.05, cases, maxErrorDb: worst, maxCenterErrorDb: centerError };
    window.testResult = (async () => {
      const waves = [];
      for (const fallback of [false, true]) for (const mode of ['dc', 'eq', 'negative']) {
        const rate = 48000, ctx = new OfflineAudioContext(1, rate, rate);
        const filters = exports.EQ_FREQUENCIES.map((frequency, i) => {
          const node = ctx.createBiquadFilter(); node.type = 'peaking';
          node.frequency.value = frequency; node.Q.value = exports.filterQ(i, rate); return node;
        });
        const preamp = ctx.createGain(), protection = ctx.createGain();
        filters.forEach((node, i) => node.connect(filters[i + 1] || preamp));
        preamp.connect(protection); protection.connect(ctx.destination);
        if (fallback) [...filters.map(n => n.gain), preamp.gain, protection.gain].forEach(param => Object.defineProperty(param, 'cancelAndHoldAtTime', { value: undefined }));
        let time = 0;
        const clock = { sampleRate: rate, get currentTime() { return time; } };
        let settings = { ...exports.defaultEqualizer(), enabled: true, autoPreamp: mode !== 'dc', ...(mode === 'negative' ? { bands: [...exports.EQ_PRESETS.find(p => p.id === 'rock').bands], preamp: -12 } : {}) };
        const automation = modules['./equalizer-automation'].createEqualizerAutomation(clock, filters, preamp, protection, settings);
        let source;
        if (mode !== 'eq') {
          source = ctx.createConstantSource(); source.offset.value = 0.2; source.connect(filters[0]);
        } else {
          source = ctx.createOscillator(); source.frequency.value = 1000;
          const level = ctx.createGain(); level.gain.value = 0.05; source.connect(level); level.connect(filters[0]);
        }
        source.start();
        // DC 不受 peaking 稳态影响，直接测手动增益快速反复重调度的连续性。
        for (let i = 0; i < 40; i++) {
          time = 0.1 + i * 0.008;
          settings = mode === 'negative' ? { ...settings, preset: 'saved-' + i, bands: [...settings.bands] } : { ...settings, preamp: i % 2 ? -12 : 6, bands: mode === 'eq' ? Array.from({ length: 10 }, (_, band) => (i + band) % 2 ? -12 : 12) : settings.bands };
          automation.update(settings);
        }
        time = 0.5; automation.update({ ...settings, enabled: false });
        const data = (await ctx.startRendering()).getChannelData(0);
        let jump = 0, peak = 0, savedLevelError = 0;
        for (let i = 1; i < data.length; i++) {
          // 跳变只测交互阶段，排除从零启动 DC 本身引发的 IIR 激励。
          if (i >= rate * 0.09) jump = Math.max(jump, Math.abs(data[i] - data[i-1]));
          peak = Math.max(peak, Math.abs(data[i]));
          if (mode === 'negative' && i > rate * 0.25 && i < rate * 0.4) savedLevelError = Math.max(savedLevelError, Math.abs(data[i] - 0.2 * Math.pow(10, -12 / 20)));
        }
        const expectedEnd = mode !== 'eq' ? 0.2 : 0.05 * Math.sin(2 * Math.PI * 1000 * (data.length - 1) / rate);
        waves.push({ fallback, mode, savedLevelError, maxAdjacentJump: jump, peak, bypassError: Math.abs(data[data.length-1] - expectedEnd) });
      }
      report.waves = waves;
      report.passed = report.passed && waves.every(w => w.maxAdjacentJump < (w.mode !== 'eq' ? 0.002 : 0.03) && w.peak < (w.mode !== 'eq' ? 0.41 : 0.15) && w.bypassError < 0.0001 && w.savedLevelError < 0.00001);
      return report;
    })();
  </script>`)
  // CDP awaitPromise 等待 OfflineAudioContext 完成，避免虚拟时钟提前结束渲染。
  const { spawn } = await import('node:child_process')
  const { existsSync } = await import('node:fs')
  const profile = join(directory, 'profile')
  const child = spawn(chrome, ['--headless', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', pathToFileURL(page).href], { stdio: 'ignore' })
  let launchError
  child.on('error', error => { launchError = error })
  let socket
  let report
  try {
    const portFile = join(profile, 'DevToolsActivePort')
    for (let i = 0; !existsSync(portFile) && i < 100; i++) {
      if (launchError) throw launchError
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const port = readFileSync(portFile, 'utf8').split('\n')[0]
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const target = pages.find(p => p.type === 'page')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let id = 0
    const evaluate = expression => new Promise((resolve, reject) => {
      const request = ++id
      const timeout = setTimeout(() => reject(new Error('浏览器音频测试超时')), 20000)
      const listener = event => {
        const result = JSON.parse(event.data)
        if (result.id !== request) return
        socket.removeEventListener('message', listener); clearTimeout(timeout)
        if (result.error || result.result?.exceptionDetails) reject(new Error(JSON.stringify(result)))
        else resolve(result.result.result.value)
      }
      socket.addEventListener('message', listener)
      socket.send(JSON.stringify({ id: request, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
    for (let i = 0; i < 100; i++) {
      if (await evaluate('typeof window.testResult !== "undefined"')) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    report = JSON.stringify(await evaluate('window.testResult'))
  } finally {
    socket?.close()
    child.kill('SIGTERM')
    await new Promise(resolve => { child.once('close', resolve); setTimeout(resolve, 2000) })
  }
  const parsed = JSON.parse(report)
  process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`)
  if (!parsed.passed) process.exitCode = 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
