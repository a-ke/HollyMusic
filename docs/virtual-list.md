# 公共虚拟列表

`components/shared/VirtualList.tsx` 是面向等高行的公共组件，`SongList` 已统一接入。

- 整个列表从首次渲染起保留完整高度，滚动条表示全部数据；只挂载可视区域及上下缓冲区。
- 自动使用最近的滚动容器，找不到时使用窗口滚动；也可以传入 `scrollParentRef`。不增加内层滚动条。
- 支持稳定条目 key、行间距、预估行高与缓冲行数；首行实际高度和窗口变化会触发校准。
- 不超过 60 项的小列表直接完整渲染。
- 不包含歌曲、播放队列或请求逻辑，其他等高条目列表可以独立使用。

```tsx
<VirtualList
  items={rows}
  itemKey={row => row.id}
  renderItem={row => <MyRow row={row} />}
  estimateRowHeight={60}
  gap={2}
/>
```

本组件复用页面原有滚动容器。仓库虽已安装 `react-window`，此前没有实际使用或公共封装；此次没有新增依赖。

回归测试：`frontend/components/VirtualList.test.tsx`，以及首页歌单、排行榜和我的歌单的性能回归测试。覆盖完整高度、拖动到末尾、页头偏移、尺寸变化和完整播放队列。
