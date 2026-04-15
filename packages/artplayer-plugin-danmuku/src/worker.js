function getDanmuTop({
  target,
  visibles,
  clientWidth,
  clientHeight,
  marginBottom,
  marginTop,
  antiOverlap,
  density
}) {
  const maxTop = clientHeight - marginBottom
  const minGapRatio = density / 100   // 0.1 ~ 0.9
  const minHorizontalGap = Math.max(20, clientWidth * minGapRatio)  // 至少20px保护

  // ====================== 固定模式 1 (顶部) ======================
  if (target.mode === 1) {
    // 【修改】：提前过滤掉因为修改 margin 而被挤出合法区域的历史旧弹幕
    let danmus = visibles
        .filter(item => item.mode === 1 && item.top < maxTop && (item.top + item.height) > marginTop)
        .sort((a, b) => a.top - b.top)

    const verticalGap = Math.round(target.height * (0.8 + minGapRatio))

    if (danmus.length === 0) {
        if (marginTop + target.height <= maxTop) return marginTop
        return undefined
    }

    if (danmus[0].top - marginTop >= target.height + verticalGap) {
        return marginTop
    }

    for (let i = 1; i < danmus.length; i++) {
      const prevBottom = danmus[i - 1].top + danmus[i - 1].height
      if (danmus[i].top - prevBottom >= target.height + verticalGap) {
        if (prevBottom + target.height <= maxTop) return prevBottom
      }
    }

    const last = danmus[danmus.length - 1]
    if (last.top + last.height + verticalGap + target.height <= maxTop) {
      return last.top + last.height + verticalGap
    }
    return undefined
  }

  // ====================== 固定模式 2 (底部) ======================
  if (target.mode === 2) {
    // 【修改】：提前过滤越界弹幕
    let danmus = visibles
        .filter(item => item.mode === 2 && item.top < maxTop && (item.top + item.height) > marginTop)
        .sort((a, b) => a.top - b.top) // 从上到下排序

    const verticalGap = Math.round(target.height * (0.8 + minGapRatio))

    if (danmus.length === 0) {
        if (maxTop - target.height >= marginTop) return maxTop - target.height
        return undefined
    }

    // 优先排在最底下
    const last = danmus[danmus.length - 1]
    if (maxTop - (last.top + last.height) >= target.height + verticalGap) {
       return maxTop - target.height
    }

    // 检查中间的空隙 (从下往上遍历，确保底部堆叠紧密)
    for (let i = danmus.length - 1; i > 0; i--) {
       const currentTop = danmus[i].top
       const prevBottom = danmus[i - 1].top + danmus[i - 1].height
       if (currentTop - prevBottom >= target.height + verticalGap) {
           const expectedTop = currentTop - verticalGap - target.height
           // 严格护栏：不能顶破天花板
           if (expectedTop >= marginTop) return expectedTop
       }
    }

    // 实在不行，排在最顶层那条的上方
    const first = danmus[0]
    const expectedTop = first.top - verticalGap - target.height
    if (expectedTop >= marginTop) {
       return expectedTop
    }

    return undefined
  }

  // ====================== 滚动模式 0 (从右向左) ======================
  if (target.mode === 0) {
    const rolling = visibles.filter(item => item.mode === 0)

    if (rolling.length === 0) {
      if (marginTop + target.height <= maxTop) return marginTop
      return undefined
    }

    // 收集所有现有轨道
    const tracks = new Map()
    rolling.forEach(d => {
      const rightEdge = d.left + d.width
      const currentTop = Math.round(d.top)
      if (!tracks.has(currentTop) || rightEdge > tracks.get(currentTop)) {
        tracks.set(currentTop, rightEdge)
      }
    })

    // 1. 优先尝试复用已有轨道
    for (let [trackTop, lastRight] of tracks.entries()) {
      // 【核心护栏 1】：这条轨道必须在*当前*的合法区域内，如果是历史弹幕的越界轨道，直接无视它！
      if (trackTop >= marginTop && (trackTop + target.height) <= maxTop) {
        if (lastRight + minHorizontalGap <= clientWidth) {
          return trackTop
        }
      }
    }

    // 2. 尝试在垂直方向开辟新轨道
    if (antiOverlap && rolling.length > 0) {
      // 【核心护栏 2】：把已经越界的老轨道踢出计算群组，它们不参与新空隙的分割计算
      let sortedTracks = Array.from(tracks.keys())
         .filter(top => top >= marginTop && top < maxTop)
         .sort((a, b) => a - b)

      let virtualDanmus = sortedTracks.map(top => ({
        top: top,
        height: target.height
      }))

      // 头尾塞入虚拟墙壁
      virtualDanmus.unshift({ top: 0, height: marginTop })
      virtualDanmus.push({ top: maxTop, height: marginBottom })

      for (let i = 1; i < virtualDanmus.length; i++) {
        const prev = virtualDanmus[i - 1]
        const curr = virtualDanmus[i]
        const prevBottom = prev.top + prev.height
        const diff = curr.top - prevBottom

        if (diff >= target.height + 18) {
          // 【核心护栏 3】：确认算出来的位置，哪怕加上自身高度，也不会超过最底线
          if (prevBottom + target.height <= maxTop) {
            return prevBottom
          }
        }
      }
    }

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
