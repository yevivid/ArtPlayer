function getDanmuTop({
  target,
  visibles,
  clientWidth,
  clientHeight,
  marginBottom,
  marginTop,
  antiOverlap,
  density,
  fontSize,
}) {
  const maxTop = clientHeight - marginBottom
  const minGapRatio = density / 100 // 0.1 ~ 0.9
  const minHorizontalGap = Math.max(20, clientWidth * minGapRatio) // 至少20px保护

  // 使用固定的轨道高度（基于字体大小），与 kickOverlapping 保持一致
  const trackHeight = Math.ceil(fontSize * 1.125)

  // ====================== 固定模式 1 (顶部) ======================
  if (target.mode === 1) {
    // 固定限制：普通固定弹幕始终限制在显示区域总轨道数的 1/2
    const totalPossibleTracks = Math.floor((maxTop - marginTop) / trackHeight)
    const maxAllowedCount = Math.floor(totalPossibleTracks * 0.5)

    const currentFixedNormalCount = visibles.filter(
      item => item.mode === 1 && !item.isHero
    ).length

    if (!target.isHero && currentFixedNormalCount >= maxAllowedCount) {
      return undefined
    }

    // 收集所有被占用的像素范围（基于固定轨道高度）
    const occupied = []
    const visibleFixed = visibles
      .filter(item => item.mode === 1 && item.top < maxTop && (item.top + item.height) > marginTop)
    visibleFixed.forEach((item) => {
      occupied.push({ top: item.top, bottom: item.top + item.height })
    })

    // 按固定轨道步长尝试所有可能的位置，找到不重叠的位置
    const available = []
    for (let tryTop = marginTop; tryTop + target.height <= maxTop; tryTop += trackHeight) {
      let overlaps = false
      for (const range of occupied) {
        if (tryTop < range.bottom && tryTop + target.height > range.top) {
          overlaps = true
          break
        }
      }
      if (!overlaps)
        available.push(tryTop)
    }

    if (available.length > 0)
      return available[Math.floor(Math.random() * available.length)]
    return undefined
  }

  // ====================== 滚动模式 0 (从右向左) ======================
  if (target.mode === 0) {
    const rolling = visibles.filter(item => item.mode === 0)

    if (rolling.length === 0) {
      if (marginTop + target.height <= maxTop)
        return marginTop
      return undefined
    }

    // 收集所有现有轨道
    const tracks = new Map()
    rolling.forEach((d) => {
      const rightEdge = d.left + d.width
      const currentTop = Math.round(d.top)
      if (!tracks.has(currentTop) || rightEdge > tracks.get(currentTop)) {
        tracks.set(currentTop, rightEdge)
      }
    })

    // 1. 收集所有可用的已有轨道，随机选一条
    const availableTracks = []
    for (const [trackTop, lastRight] of tracks.entries()) {
      if (trackTop >= marginTop && (trackTop + target.height) <= maxTop) {
        if (lastRight + minHorizontalGap <= clientWidth) {
          availableTracks.push(trackTop)
        }
      }
    }
    if (availableTracks.length > 0) {
      return availableTracks[Math.floor(Math.random() * availableTracks.length)]
    }

    // 2. 收集所有可用的新轨道空隙，随机选一个
    if (antiOverlap && rolling.length > 0) {
      const sortedTracks = Array.from(tracks.keys())
        .filter(top => top >= marginTop && top < maxTop)
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
