function getDanmuTop({
    target,
    visibles,
    clientWidth,
    clientHeight,
    marginBottom,
    marginTop,
    antiOverlap,
    density = 1,           // 0=最稀疏, 1=普通, 2=密集
    minVerticalGap = 12
}) {
    const maxTop = clientHeight - marginBottom;

    // 只处理滚动弹幕（mode 0），顶部/底部保持简单逻辑
    if (target.mode !== 0) {
        const danmus = visibles
            .filter(item => item.mode === target.mode)
            .sort((a, b) => a.top - b.top);

        if (danmus.length === 0) {
            return target.mode === 2 ? maxTop - target.height : marginTop;
        }

        // 顶部/底部固定弹幕暂时不做复杂 density 处理
        return target.mode === 2
            ? maxTop - target.height
            : marginTop;
    }

    // ====================== 滚动弹幕核心逻辑 ======================
    let danmus = visibles
        .filter(item => item.mode === 0)
        .sort((a, b) => a.top - b.top);

    if (danmus.length === 0) {
        return marginTop;
    }

    // 根据 density 大幅调整垂直间距（这是让稀疏明显的关键）
    const gapMultiplier = density === 0 ? 2.2 : density === 1 ? 1.35 : 1.0;
    const safeGap = Math.round(minVerticalGap * gapMultiplier);

    // 上下虚拟边界
    danmus.unshift({ top: 0, height: marginTop });
    danmus.push({ top: maxTop, height: marginBottom });

    // 第一优先级：找干净的足够大空隙（干净插入）
    for (let i = 1; i < danmus.length; i++) {
        const prev = danmus[i - 1];
        const curr = danmus[i];
        const prevBottom = prev.top + prev.height;
        const diff = curr.top - prevBottom;

        if (diff >= target.height + safeGap) {
            return prevBottom;           // 找到干净位置，直接返回
        }
    }

    // 第二优先级：根据 density 在最大空隙中间插入（最重要！）
    if (density >= 1) {
        let maxGap = 0;
        let bestY = marginTop;

        for (let i = 1; i < danmus.length; i++) {
            const prev = danmus[i - 1];
            const curr = danmus[i];
            const gap = curr.top - (prev.top + prev.height);

            if (gap > maxGap) {
                maxGap = gap;
                bestY = prev.top + prev.height + (gap - target.height) / 2;
            }
        }

        // density=0 时要求更大空隙才插入，density=2 更激进
        const requiredGapRatio = density === 0 ? 1.1 : density === 1 ? 0.75 : 0.55;
        if (maxGap >= target.height * requiredGapRatio) {
            return Math.max(marginTop, Math.min(Math.floor(bestY), maxTop - target.height));
        }
    }

    // 第三优先级：如果开了 antiOverlap，尝试原有防重叠逻辑作为兜底
    if (antiOverlap) {
        // 你原来的 topMap + 防重叠逻辑（简化保留）
        const topMap = [];
        for (let i = 1; i < danmus.length - 1; i++) {
            const item = danmus[i];
            if (!item.speed) continue;
            if (topMap.length && topMap[topMap.length - 1][0].top === item.top) {
                topMap[topMap.length - 1].push(item);
            } else {
                topMap.push([item]);
            }
        }

        const result = topMap.find(list =>
            list.every(danmu => {
                if (clientWidth < (danmu.distance || danmu.width)) return false;
                if (target.speed < danmu.speed) return true;
                const overlapTime = (danmu.right || 0) / (target.speed - danmu.speed);
                return overlapTime > (danmu.time || 999);
            })
        );

        if (result && result[0]) return result[0].top;
    }

    // 实在放不下，返回 undefined（由主线程转 ready，等待弹幕离开）
    return undefined;
}

onmessage = (event) => {
  const { data } = event
  if (!data.id || !data.type)
    return

  const fns = { getDanmuTop }
  const fn = fns[data.type]
  const result = fn(data)

  globalThis.postMessage({
    result,
    id: data.id,
  })
}
