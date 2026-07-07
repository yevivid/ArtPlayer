import { beginChunk, detectSimilarity } from './wasm/similarity'

function selectMedianLength(strs) {
  if (strs.length === 1) return strs[0]
  const sorted = [...strs].sort((a, b) => a.length - b.length)
  return sorted[Math.floor(sorted.length / 2)]
}

const CHUNK_SIZE = 5000

function processChunk(chunkItems, opts) {
  const { threshold, maxDist, maxCosine, trimPinyin, crossMode } = opts
  const THRESHOLD_MS = threshold * 1000

  beginChunk(maxDist, maxCosine, trimPinyin, crossMode)

  const storage = []
  let indexL = 0
  let indexR = 0

  for (let i = 0; i < chunkItems.length; i++) {
    const dm = chunkItems[i]
    const dmTimeMs = (dm.time || 0) * 1000
    const normalized = dm._normalizedText || dm.text

    while (indexL < indexR) {
      const peeked = storage[indexL]
      if (!peeked || dmTimeMs - peeked.timeMs <= THRESHOLD_MS) break
      indexL++
    }

    const sim = detectSimilarity(normalized, dm.mode || 0, indexL)

    if (sim) {
      const targetIdx = indexR - sim.idxDiff
      if (targetIdx >= 0 && targetIdx < storage.length) {
        storage[targetIdx].items.push(dm)
      }
      else {
        storage[indexR] = { timeMs: dmTimeMs, items: [dm] }
        indexR++
      }
    }
    else {
      storage[indexR] = { timeMs: dmTimeMs, items: [dm] }
      indexR++
    }
  }

  return storage
}

export function mergeDanmuku(danmuku, options = {}) {
  const {
    threshold = 30,
    maxDist = 5,
    maxCosine = 45,
    trimPinyin = true,
    crossMode = true,
  } = options

  if (!danmuku || danmuku.length === 0) return []

  const sorted = [...danmuku].sort((a, b) => (a.time || 0) - (b.time || 0))

  const opts = { threshold, maxDist, maxCosine, trimPinyin, crossMode }

  // 分片处理，每片独立 beginChunk
  const allClusters = []
  for (let start = 0; start < sorted.length; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, sorted.length)
    const chunk = sorted.slice(start, end)
    const clusters = processChunk(chunk, opts)
    for (let i = 0; i < clusters.length; i++) {
      allClusters.push(clusters[i])
    }
  }

  // 生成输出
  const result = []
  for (let i = 0; i < allClusters.length; i++) {
    const cluster = allClusters[i]
    if (cluster.items.length === 1) {
      const dm = { ...cluster.items[0] }
      delete dm._normalizedText
      result.push(dm)
    }
    else {
      const textCounts = new Map()
      for (const item of cluster.items) {
        const t = item._normalizedText || item.text
        textCounts.set(t, (textCounts.get(t) || 0) + 1)
      }
      let maxCount = 0
      for (const [, count] of textCounts) {
        if (count > maxCount) maxCount = count
      }
      const chosenText = selectMedianLength(
        [...textCounts.entries()]
          .filter(([, c]) => c === maxCount)
          .map(([t]) => t),
      )
      const repr = {
        ...cluster.items[0],
        text: chosenText,
        _mergeCount: cluster.items.length,
      }
      delete repr._normalizedText
      result.push(repr)
    }
  }

  return result
}
