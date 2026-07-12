// 英雄弹幕调度器
// 30秒分桶 → 每桶选一个英雄(∑>10) → 其余∑>5降级为滚动

const BUCKET_SIZE = 30
const HERO_THRESHOLD = 10
const DEMOTE_THRESHOLD = 5

const DEBUG = false
function debug(...args) {
  if (DEBUG)
    console.log('[Hero]', ...args)
}
function log(...args) {
  console.log('[Hero]', ...args)
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

export function scheduleHeroDanmuku(danmus) {
  // 清除旧标记
  for (const d of danmus) {
    d._isHero = false
  }

  // 按30秒分桶，从头到尾标记所有英雄
  const buckets = new Map()
  for (const d of danmus) {
    const id = Math.floor((d.time || 0) / BUCKET_SIZE)
    if (!buckets.has(id))
      buckets.set(id, [])
    buckets.get(id).push(d)
  }

  debug(`开始调度 | 从头到尾 | 桶数: ${buckets.size}`)

  // 每桶选英雄
  let heroCount = 0
  let demoteCount = 0
  for (const [, bucket] of buckets) {
    const candidates = bucket.filter(d => (d._mergeCount || 0) > HERO_THRESHOLD)
    if (candidates.length === 0)
      continue

    // 前5名中随机选1个
    candidates.sort((a, b) => (b._mergeCount || 0) - (a._mergeCount || 0))
    const top5 = candidates.slice(0, Math.min(5, candidates.length))
    const hero = top5[Math.floor(Math.random() * top5.length)]

    hero._isHero = true
    hero.mode = 1
    heroCount++
    log(`🏆 ${hero.text} | ∑${hero._mergeCount} | 时间: ${formatTime(hero.time)} | 候选${candidates.length}条`)

    // 同桶其余∑>5降级
    for (const d of bucket) {
      if (d !== hero && (d._mergeCount || 0) > DEMOTE_THRESHOLD) {
        d.mode = 0
        demoteCount++
      }
    }
  }

  debug(`调度完成 | 英雄: ${heroCount}个 | 降级: ${demoteCount}条`)
}
