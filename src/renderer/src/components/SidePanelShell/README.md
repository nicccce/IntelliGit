# SidePanelShell

侧边面板骨架组件，为所有侧边面板提供统一的 Header、ResizeHandle（拉伸条）和 Body 容器。

## 职责

- **拉伸功能**：通过鼠标拖拽 ResizeHandle 改变面板宽度，宽度值写入 `uiStore.sidePanelWidth`，所有面板共享同一宽度状态
- **Header**：标题 + 关闭按钮，关闭时触发 `onClose` 回调
- **Body**：flex 容器，padding 和 gap 由本组件样式控制，内容由调用方提供

## Props

| 属性 | 类型 | 默认 | 说明 |
|---|---|---|---|
| title | `string` | — | 面板标题 |
| isOpen | `boolean` | — | 是否显示 |
| onClose | `() => void` | — | 关闭回调 |
| children | `ReactNode` | — | 主体内容 |
| minWidth | `number` | 200 | 最小拉伸宽度 |
| maxWidth | `number` | 520 | 最大拉伸宽度 |

## 使用示例

```tsx
<SidePanelShell title="仓库列表" isOpen={isOpen} onClose={onClose}>
  {/* 面板内容 */}
</SidePanelShell>
```

## 注意事项

- 所有侧边面板应使用本组件包装，避免重复实现拉伸逻辑
- 面板关闭`（isOpen=false）`时返回 `null`，不渲染 DOM
- 样式文件定义于本目录，面板专属样式保留在各模块内