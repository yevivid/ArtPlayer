function getDanmuTop({
  target,
  visibles,
  clientWidth,
  clientHeight,
  marginBottom,
  marginTop,
  antiOverlap,
  sparsity = 30,          // 10~90
}) {
  const maxTop = clientHeight - marginBottom
  const minGapRatio = sparsity / 100   // 0.1 ~ 0.9
  const minHorizontalGap = Math.max(20, clientWidth * minGapRatio)  // 至少20px保护

  // ====================== 固定模式（mode 1 & 2）保持上版逻辑 ======================
  if (target.mode === 1) {
    let danmus = visibles.filter(item => item.mode === 1).sort((a, b) => a.top - b.top)
    if (danmus.length === 0) return marginTop

    const verticalGap = Math.round(target.height * (0.8 + minGapRatio))  // sparsity越大间距越大

    for (let i = 0; i < danmus.length; i++) {
      const prevBottom = i === 0 ? marginTop : danmus[i - 1].top + danmus[i - 1].height
      if (danmus[i].top - prevBottom >= target.height + verticalGap) {
        return prevBottom
      }
    }

    const last = danmus[danmus.length - 1]
    if (last.top + last.height + target.height + verticalGap <= maxTop) {
      return last.top + last.height + verticalGap
    }
    return undefined
  }

  if (target.mode === 2) {
    let danmus = visibles.filter(item => item.mode === 2).sort((a, b) => a.top - b.top)
    if (danmus.length === 0) return maxTop - target.height

    const verticalGap = Math.round(target.height * (0.8 + minGapRatio))

    for (let i = danmus.length - 1; i >= 0; i--) {
      const itemBottom = danmus[i].top + danmus[i].height
      if (maxTop - itemBottom >= target.height + verticalGap) {
        return maxTop - target.height
      }
    }
    return undefined
  }

  // ====================== 滚动模式（mode 0）—— 改进版轨道管理 ======================
  if (target.mode === 0) {
    const rolling = visibles.filter(item => item.mode === 0)

    if (rolling.length === 0) {
      return marginTop
    }

    // 按 top 分组构建轨道信息：每个轨道记录最后一条弹幕的 rightEdge（右边缘位置）
    const tracks = new Map()  // top -> lastRightEdge

    rolling.forEach(d => {
      const rightEdge = d.left + d.width
      const currentTop = Math.round(d.top)   // 四舍五入避免浮点误差
      if (!tracks.has(currentTop) || rightEdge > tracks.get(currentTop)) {
        tracks.set(currentTop, rightEdge)
      }
    })

    // 1. 优先尝试复用已有轨道（同一 top）
    for (let [trackTop, lastRight] of tracks.entries()) {
      // 如果最后一条的右边缘 + 最小间隔 <= 当前屏幕右边，说明轨道已空闲足够距离
      if (lastRight + minHorizontalGap <= clientWidth) {
        return trackTop   // 复用该轨道
      }
    }

    // 2. 没有可用轨道 → 尝试在垂直方向开辟新轨道（使用 antiOverlap 逻辑）
    if (antiOverlap && rolling.length > 0) {
      let sortedTracks = Array.from(tracks.keys()).sort((a, b) => a - b)
      let virtualDanmus = sortedTracks.map(top => ({
        top: top,
        height: target.height   // 近似使用新弹幕高度
      }))

      virtualDanmus.unshift({ top: 0, height: marginTop })
      virtualDanmus.push({ top: maxTop, height: marginBottom })

      for (let i = 1; i < virtualDanmus.length; i++) {
        const prev = virtualDanmus[i - 1]
        const curr = virtualDanmus[i]
        const prevBottom = prev.top + prev.height
        const diff = curr.top - prevBottom

        if (diff >= target.height + 18) {   // 垂直最小安全间距，可微调
          return prevBottom
        }
      }
    }

    // 3. 实在没有位置，暂不显示，等待下一帧再尝试
    return undefined
  }

  return marginTop
}

onmessage = (event) => {
  const { data } = event
  if (!data.id || !data.type) return

  const fns = { getDanmuTop }
  const result = fns[data.type](data)

  globalThis.postMessage({ result, id: data.id })
}
