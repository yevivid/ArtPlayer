function getDanmuTop({
    target,
    visibles,
    clientWidth,
    clientHeight,
    marginBottom,
    marginTop,
    antiOverlap,
    density = 1,
    minVerticalGap = 12
}) {
    const maxTop = clientHeight - marginBottom;

    // 根据 density 动态计算安全间距
    const gapMultiplier = density === 0 ? 2.2 : density === 1 ? 1.4 : 1.0;
    const safeGap = Math.round(minVerticalGap * gapMultiplier);

    // ====================== 模式 1：顶部固定弹幕 ======================
    if (target.mode === 1) {
        let danmus = visibles
            .filter(item => item.mode === 1)
            .sort((a, b) => a.top - b.top);

        // 如果没有任何顶部弹幕，直接放在最顶部
        if (danmus.length === 0) {
            return marginTop;
        }

        const safeGap = minVerticalGap + (density === 0 ? 18 : density === 1 ? 10 : 4);

        // 1. 优先从上到下找干净空隙
        for (let i = 0; i < danmus.length; i++) {
            const prevBottom = (i === 0 ? marginTop : danmus[i - 1].top + danmus[i - 1].height);
            const diff = danmus[i].top - prevBottom;

            if (diff >= target.height + safeGap) {
                return prevBottom;
            }
        }

        // 2. 如果所有位置都满了，根据 density 决定是否强行插入（在最大空隙中间）
        if (density >= 1) {
            let maxGap = 0;
            let bestY = marginTop;

            for (let i = 0; i < danmus.length; i++) {
                const prevBottom = (i === 0 ? marginTop : danmus[i - 1].top + danmus[i - 1].height);
                const gap = danmus[i].top - prevBottom;
                if (gap > maxGap) {
                    maxGap = gap;
                    bestY = prevBottom + (gap - target.height) / 2;
                }
            }

            // density 越低，要求空隙越大；density=2 时更激进允许重叠
            const requiredGap = target.height * (density === 0 ? 1.2 : density === 1 ? 0.8 : 0.5);
            if (maxGap >= requiredGap) {
                return Math.max(marginTop, Math.min(Math.floor(bestY), maxTop - target.height));
            }
        }

        // 3. 最后兜底：强制放在最后一条下面（即使会轻微重叠）
        const last = danmus[danmus.length - 1];
        const lastBottom = last.top + last.height;
        if (lastBottom + target.height + safeGap <= maxTop) {
            return lastBottom + safeGap;
        }

        // 实在放不下，返回 undefined（会被丢弃）
        return undefined;
    }

    // ====================== 模式 2：底部固定弹幕 ======================
    if (target.mode === 2) {
        let danmus = visibles
            .filter(item => item.mode === 2)
            .sort((a, b) => a.top - b.top);

        if (danmus.length === 0) {
            return maxTop - target.height;
        }

        // 从下往上寻找空隙
        for (let i = danmus.length - 1; i >= 0; i--) {
            const itemBottom = danmus[i].top + danmus[i].height;
            const diff = maxTop - itemBottom;

            if (diff >= target.height + safeGap) {
                return maxTop - target.height;
            }
        }

        // 找不到时尝试在最大空隙插入
        if (density >= 1) {
            let maxGap = 0;
            let bestY = maxTop - target.height;

            for (let i = 0; i < danmus.length; i++) {
                const prevBottom = (i === 0 ? 0 : danmus[i - 1].top + danmus[i - 1].height);
                const gap = danmus[i].top - prevBottom;
                if (gap > maxGap) {
                    maxGap = gap;
                    bestY = prevBottom + (gap - target.height) / 2;
                }
            }

            if (maxGap >= target.height * (density === 1 ? 0.75 : 0.55)) {
                return Math.max(marginTop, Math.min(bestY, maxTop - target.height));
            }
        }

        return undefined;
    }

    // ====================== 模式 0：滚动弹幕 ======================
    let danmus = visibles
        .filter(item => item.mode === 0)
        .sort((a, b) => a.top - b.top);

    if (danmus.length === 0) {
        return marginTop + (density === 0 ? 35 : 18);
    }

    danmus.unshift({ top: 0, height: marginTop });
    danmus.push({ top: maxTop, height: marginBottom });

    // 优先干净插入
    for (let i = 1; i < danmus.length; i++) {
        const prev = danmus[i - 1];
        const curr = danmus[i];
        const prevBottom = prev.top + prev.height;
        const diff = curr.top - prevBottom;

        if (diff >= target.height + safeGap) {
            return prevBottom;
        }
    }

    // density 控制的优雅插入
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

        const requiredRatio = density === 1 ? 0.75 : 0.55;
        if (maxGap >= target.height * requiredRatio) {
            return Math.max(marginTop, Math.min(bestY, maxTop - target.height));
        }
    }

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
