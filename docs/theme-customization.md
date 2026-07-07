# ArtPlayer 主题配色自定义指南

## 概述

ArtPlayer 支持通过 CSS 变量自定义主题配色。主要涉及两部分：

1. **播放器核心** — 进度条、音量条、控制栏等（通过 `theme` / `cssVar` 配置）
2. **弹幕插件** — 弹幕控制面板 UI（通过 `highlight` 配置）

---

## 一、播放器核心主题色

### 配置方式

```js
const art = new Artplayer({
  url: '/video.mp4',
  
  // 快捷设置主题色（等同于 cssVar['--art-theme']）
  theme: '#00a1d6',
  
  // 自定义 CSS 变量
  cssVar: {
    '--art-theme': '#00a1d6',           // 主题色（进度条、音量、按钮高亮）
    '--art-progress-color': 'rgba(0, 161, 214, 0.25)', // 进度条背景色
    '--art-font-color': '#fff',         // 字体颜色
    '--art-background-color': '#000',   // 背景色
  }
})
```

### 可用 CSS 变量一览

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `--art-theme` | `#f00` | 主题色（进度条已播放、音量、按钮高亮） |
| `--art-font-color` | `#fff` | 字体颜色 |
| `--art-background-color` | `#000` | 背景色 |
| `--art-text-shadow-color` | `rgba(0,0,0,0.5)` | 文字阴影色 |
| `--art-progress-color` | `rgba(255,255,255,0.25)` | 进度条/音量滑轨背景色 |
| `--art-loaded-color` | `rgba(255,255,255,0.25)` | 已加载进度颜色 |
| `--art-hover-color` | `rgba(255,255,255,0.25)` | 悬停色 |
| `--art-widget-background` | `rgba(0,0,0,0.85)` | 设置面板背景色 |
| `--art-tip-background` | `rgba(0,0,0,0.7)` | 提示背景色 |
| `--art-progress-height` | `6px` | 进度条高度 |
| `--art-control-height` | `46px` | 控制栏高度 |
| `--art-control-opacity` | `0.75` | 控制栏透明度 |

### 运行时修改

```js
// 修改主题色
art.theme = '#00a1d6'

// 修改任意 CSS 变量
art.cssVar('--art-progress-color', 'rgba(0, 161, 214, 0.25)')
```

---

## 二、弹幕插件主题色

### 配置方式

```js
const art = new Artplayer({
  url: '/video.mp4',
  plugins: [
    artplayerPluginDanmuku({
      highlight: '#00a1d6',  // 弹幕插件 UI 高亮色
      // ...其他弹幕配置
    })
  ]
})
```

### highlight 配置项

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `highlight` | `string` | `''` (默认蓝色 `#00a1d6`) | 控制弹幕面板中所有高亮元素的颜色 |

### highlight 影响的元素

- 滑动条进度条和圆点
- 发送按钮背景色
- 模式切换高亮色
- 配置面板中的悬停色
- SVG 图标颜色（模式图标、勾选图标等）

### 运行时修改

```js
// 通过 config 方法动态修改
art.plugins.artplayerPluginDanmuku.config({
  highlight: '#ff6600'
})
```

---

## 三、完整示例

```js
const art = new Artplayer({
  url: '/video.mp4',
  theme: '#00a1d6',
  cssVar: {
    '--art-theme': '#00a1d6',
    '--art-progress-color': 'rgba(0, 161, 214, 0.25)',
  },
  plugins: [
    artplayerPluginDanmuku({
      highlight: '#00a1d6',
      // ...其他弹幕配置
    })
  ]
})
```

### 不同主题配色示例

**B站蓝**
```js
theme: '#00a1d6',
highlight: '#00a1d6',
```

**抖音红**
```js
theme: '#fe2c55',
highlight: '#fe2c55',
```

**YouTube红**
```js
theme: '#ff0000',
highlight: '#ff0000',
```

**自定义色**
```js
theme: '#1e90ff',
highlight: '#1e90ff',
cssVar: {
  '--art-progress-color': 'rgba(30, 144, 255, 0.25)',
}
```

---

## 四、技术实现说明

### 弹幕插件实现

1. `style.less` 中使用 CSS 变量 `var(--apd-highlight, #00a1d6)` 替代硬编码颜色
2. `danmuku.js` 新增 `highlight` 配置项和校验
3. `setting.js` 中 `applyHighlight()` 方法负责：
   - 设置 CSS 变量 `--apd-highlight` 到 DOM 元素
   - 替换 SVG 图标中的蓝色填充（`#00AEEC` → 自定义颜色）

### 文件修改记录

| 文件 | 修改内容 |
|------|----------|
| `src/style.less` | `@highlight` 改为 CSS 变量 |
| `src/danmuku.js` | 新增 `highlight` 配置项和 scheme 校验 |
| `src/setting.js` | 新增 `applyHighlight()` 方法，构造函数和 `reset()` 中调用 |
