# HollyMusic Logo 资源

目前沿用原始通用 Logo，冬青方案尚未定稿。

## 当前启用

- 页面统一使用 `components/brand/HollyLogo.tsx` 中的 `HollyMark` 和 `HollyBrand`，显示通用音符与文本名称，支持自定义站名及主题配色。
- 应用图标继续使用原始紫色图标：`public/icon.svg`、`public/icon-maskable.svg`、`public/icons/` 中的 PNG。
- 前端标签页使用 `public/icon.svg`；Next.js favicon 为 `app/favicon.ico`。

重新生成当前 PWA PNG：

```sh
node scripts/gen-pwa-icons.mjs
```

Logo 定稿后，在共用组件中接入最终 SVG，并替换对应的应用图标和 favicon 即可，无需逐个修改页面。

## 冬青候选稿（未启用）

候选资源保存在 `public/brand/`；几何数据保存在 `components/brand/holly-geometry.json`。字标已转为路径，不依赖额外字体。

| 候选用途 | 文件 |
| --- | --- |
| 横排 / 竖排组合 | `holly-horizontal.svg`、`holly-stacked.svg` |
| 深色背景 | 对应的 `-light.svg` 版本 |
| 独立图形 / 小尺寸 / 单色 | `holly-mark.svg`、`holly-mark-small.svg`、`holly-mark-mono.svg` |
| 应用图标 | `holly-app.svg`、`holly-app-maskable.svg` |
| favicon | `holly-favicon.svg`、`holly-favicon.ico` |

运行前端后访问 `/brand-preview.html`，可以独立查看候选稿及深浅背景效果。

重新生成候选资源：

```sh
node scripts/gen-holly-logo.mjs
```

该脚本仅写入 `public/brand/`，不会替换当前应用图标或页面 Logo。
