function getDanmuTop({
  target,
  visibles,
  clientWidth,
  clientHeight,
  marginBottom,
  marginTop,
  antiOverlap,
  gap,
  fontSize,
}) {
  const maxTop = clientHeight - marginBottom
  const minGapRatio = gap / 100
  const minHorizontalGap = Math.max(20, clientWidth * minGapRatio)

  const trackHeight = Math.ceil(fontSize * 1.125)

  // ====================== 固定模式 1 (顶部) ======================
  if (target.mode === 1) {
    // 固定弹幕同时在屏幕上的数量不能超过总轨道数的 1/2（英雄除外）
    const totalTracks = Math.floor((maxTop - marginTop) / trackHeight)
    const normalCount = visibles.filter(item => item.mode === 1 && !item.isHero).length
    if (!target.isHero && normalCount >= Math.floor(totalTracks / 2)) {
      return undefined
    }

    const occupied = visibles
      .filter(item => item.mode === 1 && item.top < maxTop && (item.top + item.height) > marginTop)
      .map(item => ({ top: item.top, bottom: item.top + item.height }))

    const available = []
    for (let tryTop = marginTop; tryTop + target.height <= maxTop; tryTop += trackHeight) {
      const tryBottom = tryTop + target.height
      if (!occupied.some(r => tryTop < r.bottom && tryBottom > r.top)) {
        available.push(tryTop)
      }
    }

    if (available.length > 0)
      return available[Math.floor(Math.random() * available.length)]
    return undefined
  }

  // ====================== 滚动模式 0 (从右向左) ======================
  if (target.mode === 0) {
    const rolling = visibles.filter(item => item.mode === 0)

    // 收集所有被占用的轨道及其最右边缘
    const occupiedTracks = new Map()
    rolling.forEach((d) => {
      const rightEdge = d.left + d.width
      const currentTop = Math.round(d.top)
      if (!occupiedTracks.has(currentTop) || rightEdge > occupiedTracks.get(currentTop)) {
        occupiedTracks.set(currentTop, rightEdge)
      }
    })

    // 生成所有可能的轨道位置
    const allTrackPositions = []
    for (let trackTop = marginTop; trackTop + target.height <= maxTop; trackTop += trackHeight) {
      allTrackPositions.push(trackTop)
    }

    if (allTrackPositions.length === 0) {
      return undefined
    }

    // 查找所有可用轨道：该轨道存在且其右侧有足够空间
    const availableTracks = []
    for (const trackTop of allTrackPositions) {
      if (!occupiedTracks.has(trackTop)) {
        // 空轨道，直接可用
        availableTracks.push(trackTop)
      }
      else {
        // 轨道上有弹幕，检查右侧是否有足够空间
        const lastRight = occupiedTracks.get(trackTop)
        if (lastRight + minHorizontalGap <= clientWidth) {
          availableTracks.push(trackTop)
        }
      }
    }

    if (availableTracks.length > 0) {
      return availableTracks[Math.floor(Math.random() * availableTracks.length)]
    }

    // 如果没有可用轨道且开启了防重叠，尝试在已有轨道之间寻找空隙
    if (antiOverlap && rolling.length > 0) {
      const sortedTracks = Array.from(occupiedTracks.keys())
        .sort((a, b) => a - b)

      const virtualDanmus = sortedTracks.map(top => ({
        top,
        height: target.height,
      }))

      virtualDanmus.unshift({ top: 0, height: marginTop })
      virtualDanmus.push({ top: maxTop, height: marginBottom })

      const availableGaps = []
      for (let i = 1; i < virtualDanmus.length; i++) {
        const prev = virtualDanmus[i - 1]
        const curr = virtualDanmus[i]
        const prevBottom = prev.top + prev.height
        const diff = curr.top - prevBottom

        if (diff >= target.height + 18) {
          if (prevBottom + target.height <= maxTop) {
            availableGaps.push(prevBottom)
          }
        }
      }
      if (availableGaps.length > 0) {
        return availableGaps[Math.floor(Math.random() * availableGaps.length)]
      }
    }

    return undefined
  }

  return marginTop
}

onmessage = (event) => {
  const { data } = event
  if (!data.id || !data.type)
    return

  const fns = { getDanmuTop }
  const result = fns[data.type](data)

  globalThis.postMessage({ result, id: data.id })
}
