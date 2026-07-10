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
      if (sorted[i].time > tEnd) break
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

      function update(arg = []) {
        $start = null
        $stop = null
        $heatmap.innerHTML = ''

        if (!art.duration || art.option.isLive)
          return

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
          minHeight: Math.floor(svg.h * 0.05),
          sampling: Math.floor(svg.w / 100),
          smoothing: 0.2,
          flattening: 0.2,
        }

        if (typeof option === 'object') {
          Object.assign(options, option)
        }

        let points = []

        if (Array.isArray(arg) && arg.length) {
          points = [...arg]
        }
        else {
          points = computeDensity(danmuku.queue, svg.w, art.duration, options.sampling)
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
        // 1. 找热区（>=60）的最大弹幕数，作为顶部边界
        let hotMax = 60
        for (let i = 0; i < points.length; i++) {
          const count = points[i][1]
          if (count >= 60 && count > hotMax) hotMax = count
        }

        // 2. 基准线 = 60，顶部 = hotMax，在这个范围内取对数
        const baseline = svg.h * 0.45
        const coldScale = svg.h / 120
        const hotMaxH = svg.h * 0.35
        const logMax = Math.log(hotMax / 60) || 1

        // 3. 归一化
        for (let i = 0; i < points.length; i++) {
          const count = points[i][1]
          if (count >= 60) {
            // 热区：[60, hotMax] → [baseline, baseline + hotMaxH]，对数映射
            const logVal = Math.log(count / 60)
            points[i][1] = baseline + (logVal / logMax) * hotMaxH
          }
          else {
            // 冷区：[0, 60] → [baseline - 60*coldScale, baseline]，线性映射
            points[i][1] = Math.max(options.minHeight, baseline - (60 - count) * coldScale)
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

        const pathD = pointsPositions.reduce(
        (acc, e, i, a) =>
            i === 0
            ? `M ${a[a.length - 1][0]},${svg.h} L ${e[0]},${svg.h} L ${e[0]},${e[1]}`
            : `${acc} ${bezierCommand(e, i, a)}`,
        '',
        ) + ` L ${svg.w},${svg.h} z`;

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
        $start.setAttribute('offset', `${art.played * 100}%`)
        $stop.setAttribute('offset', `${art.played * 100}%`)
      }

      art.on('video:timeupdate', () => {
        if ($start && $stop) {
          $start.setAttribute('offset', `${art.played * 100}%`)
          $stop.setAttribute('offset', `${art.played * 100}%`)
        }
      })

      art.on('setBar', (type, percentage) => {
        if ($start && $stop && type === 'played') {
          $start.setAttribute('offset', `${percentage * 100}%`)
          $stop.setAttribute('offset', `${percentage * 100}%`)
        }
      })

      art.on('ready', () => update())
      art.on('resize', () => update())
      art.on('artplayerPluginDanmuku:loaded', () => update())
      art.on('artplayerPluginDanmuku:points', points => update(points))
    },
  })
}
