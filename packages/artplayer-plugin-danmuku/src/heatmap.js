const DEBUG = false
function debug(...args) {
  if (DEBUG)
    // eslint-disable-next-line no-console
    console.log('[Hero]', ...args)
}

const lib = {
  map(value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin
  },
  range(start, end, tick) {
    const s = Math.round(start / tick) * tick
    return Array.from(
      {
        length: Math.floor((end - start) / tick),
      },
      (v, k) => {
        return k * tick + s
      },
    )
  },
}

function line(pointA, pointB) {
  const lengthX = pointB[0] - pointA[0]
  const lengthY = pointB[1] - pointA[1]
  return {
    length: Math.sqrt(lengthX ** 2 + lengthY ** 2),
    angle: Math.atan2(lengthY, lengthX),
  }
}

// 滑动窗口统计弹幕密度，O(n+m) 替代 O(n*m)
function computeDensity(queue, svgWidth, duration, sampling) {
  const gap = duration / svgWidth
  const sorted = [...queue].sort((a, b) => (a.time || 0) - (b.time || 0))
  const points = []

  let head = 0
  for (let x = 0; x <= svgWidth; x += sampling) {
    const tStart = x * gap
    const tEnd = (x + sampling) * gap

    while (head < sorted.length && sorted[head].time <= tStart) head++

    let count = 0
    for (let i = head; i < sorted.length; i++) {
      if (sorted[i].time > tEnd)
        break
      count++
    }

    points.push([x, count])
  }

  return points
}

export default function heatmap(art, danmuku, option) {
  const { query } = art.constructor.utils

  art.controls.add({
    name: 'heatmap',
    position: 'top',
    html: '',
    style: {
      position: 'absolute',
      top: '-100px',
      left: '0px',
      right: '0px',
      height: '100px',
      width: '100%',
      pointerEvents: 'none',
    },
    mounted($heatmap) {
      let $start = null
      let $stop = null

      function update(arg = [], reason = 'unknown') {
        $start = null
        $stop = null
        $heatmap.innerHTML = ''

        if (!art.duration || art.option.isLive)
          return

        // 队列为空时不生成热力图（避免 resize/ready 在弹幕加载前触发的无效重建）
        if (arg.length === 0 && danmuku.queue.length === 0)
          return

        const videoSrc = art.option.url || ''
        const videoName = videoSrc.split('/').pop() || '未知'
        debug(`[Heatmap] 生成热力图 | 触发: ${reason} | 视频: ${videoName} | 时长: ${Math.round(art.duration)}s | 弹幕数: ${danmuku.queue.length}`)

        const svg = {
          w: $heatmap.offsetWidth,
          h: $heatmap.offsetHeight,
        }

        const options = {
          xMin: 0,
          xMax: svg.w,
          yMin: 0,
          yMax: 128,
          scale: 0.25,
          opacity: 0.2,
          smoothing: 0.2,
          flattening: 0.2,
          timePerPoint: 30, // 每个采样点覆盖的秒数
          hotPercentile: 0.75, // 数据的前N百分位视为热区
          hotExponent: 1.0, // 热区对比度：<1 压缩，=1 线性，>1 增强
          densityReference: 100, // 密度参考值：每采样点此数量视为满热度
        }

        if (typeof option === 'object') {
          Object.assign(options, option)
        }

        // 从 timePerPoint 推导像素步长
        const numPoints = Math.ceil(art.duration / options.timePerPoint)
        const sampling = Math.max(1, Math.floor(svg.w / numPoints))

        let points = []

        if (Array.isArray(arg) && arg.length) {
          points = [...arg]
        }
        else {
          points = computeDensity(danmuku.queue, svg.w, art.duration, sampling)
        }

        if (points.length === 0)
          return

        const lastPoint = points[points.length - 1]
        const lastX = lastPoint[0]
        const lastY = lastPoint[1]
        if (lastX !== svg.w) {
          points.push([svg.w, lastY])
        }

        // ── 底座 + 波浪 归一化 ──
        // 从数据分布自适应计算热区阈值（百分位）
        const counts = points.map(p => p[1]).sort((a, b) => a - b)
        const hotThreshold = Math.max(5, counts[Math.floor(counts.length * options.hotPercentile)])

        // 1. 找热区的最大弹幕数，作为顶部边界
        let hotMax = hotThreshold
        for (let i = 0; i < points.length; i++) {
          const count = points[i][1]
          if (count >= hotThreshold && count > hotMax)
            hotMax = count
        }

        // 2. 密度缩放：根据平均弹幕密度缩放热力图高度
        const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length
        const densityScale = Math.max(0.3, Math.min(1, avgCount / options.densityReference))
        debug(`[Heatmap] 采样点: ${points.length} | 平均弹幕: ${avgCount.toFixed(1)} | 阈值: ${hotThreshold} | 密度缩放: ${densityScale.toFixed(2)}`)

        // 3. 布局参数（按密度缩放）
        const minHeight = Math.floor(svg.h * 0.05 * densityScale)
        const baseline = svg.h * 0.45 * densityScale
        const hotMaxH = svg.h * 0.35 * densityScale
        const coldScale = (baseline - minHeight) / hotThreshold
        const hotRange = hotMax - hotThreshold || 1

        // 4. 归一化
        for (let i = 0; i < points.length; i++) {
          const count = points[i][1]
          if (count >= hotThreshold) {
            // 热区：[hotThreshold, hotMax] → [baseline, baseline + hotMaxH]，幂函数映射
            const normalized = (count - hotThreshold) / hotRange
            points[i][1] = baseline + normalized ** options.hotExponent * hotMaxH
          }
          else {
            // 冷区：[0, hotThreshold] → [minHeight, baseline]，线性映射
            points[i][1] = Math.max(minHeight, baseline - (hotThreshold - count) * coldScale)
          }
        }

        // ── 贝塞尔曲线 ──
        const controlPoint = (current, previous, next, reverse) => {
          const p = previous || current
          const n = next || current
          const o = line(p, n)
          const flat = lib.map(Math.cos(o.angle) * options.flattening, 0, 1, 1, 0)
          const angle = o.angle * flat + (reverse ? Math.PI : 0)
          const length = o.length * options.smoothing
          const x = current[0] + Math.cos(angle) * length
          const y = current[1] + Math.sin(angle) * length
          return [x, y]
        }

        const bezierCommand = (point, i, a) => {
          const cps = controlPoint(a[i - 1], a[i - 2], point)
          const cpe = controlPoint(point, a[i - 1], a[i + 1], true)
          return `C ${cps[0]},${cps[1]} ${cpe[0]},${cpe[1]} ${point[0]},${point[1]}`
        }

        // 转换为 SVG 坐标：height → y（从底部算起的高度 → SVG 的 y 坐标）
        const pointsPositions = points.map((e) => {
          const x = lib.map(e[0], options.xMin, options.xMax, 0, svg.w)
          const y = svg.h - e[1]
          return [x, y]
        })

        const pathD = `${pointsPositions.reduce(
          (acc, e, i, a) =>
            i === 0
              ? `M ${a[a.length - 1][0]},${svg.h} L ${e[0]},${svg.h} L ${e[0]},${e[1]}`
              : `${acc} ${bezierCommand(e, i, a)}`,
          '',
        )} L ${svg.w},${svg.h} z`

        $heatmap.innerHTML = `
        <svg viewBox="0 0 ${svg.w} ${svg.h}" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
            <defs>
                <linearGradient id="heatmap-solids" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style="stop-color:var(--art-theme);stop-opacity:0.4"></stop>
                    <stop offset="0%" style="stop-color:var(--art-theme);stop-opacity:0.4" id="heatmap-start"></stop>
                    <stop offset="0%" style="stop-color:#fff;stop-opacity:0.25" id="heatmap-stop"></stop>
                    <stop offset="100%" style="stop-color:#fff;stop-opacity:0.25"></stop>
                </linearGradient>
            </defs>
            <path fill="url(#heatmap-solids)" d="${pathD}"></path>
        </svg>
        `

        $start = query('#heatmap-start', $heatmap)
        $stop = query('#heatmap-stop', $heatmap)
        if ($start && $stop) {
          const raw = Number(art.played)
          const played = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0
          $start.setAttribute('offset', `${played * 100}%`)
          $stop.setAttribute('offset', `${played * 100}%`)
        }
      }

      art.on('video:timeupdate', () => {
        if ($start && $stop) {
          const raw = Number(art.played)
          const played = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0
          $start.setAttribute('offset', `${played * 100}%`)
          $stop.setAttribute('offset', `${played * 100}%`)
        }
      })

      art.on('setBar', (type, percentage) => {
        if ($start && $stop && type === 'played') {
          const raw = Number(percentage)
          const val = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0
          $start.setAttribute('offset', `${val * 100}%`)
          $stop.setAttribute('offset', `${val * 100}%`)
        }
      })

      art.on('ready', () => update([], 'ready'))
      art.on('resize', () => update([], 'resize'))
      art.on('artplayerPluginDanmuku:loaded', () => update([], 'danmuku:loaded'))
      art.on('artplayerPluginDanmuku:points', points => update(points, 'danmuku:points'))
    },
  })
}
