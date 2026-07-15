// ========== WASM 相似度检测（并行合并专用 Worker） ==========
let wasmExports = null
let HEAP16 = null
let ptrBuf = 0
const MAX_STRING_LEN = 16005

async function initWasm(wasmUrl) {
  const resp = await fetch(wasmUrl)
  const wasmBinary = await resp.arrayBuffer()
  const wasmModule = await WebAssembly.compile(wasmBinary)

  const imports = {
    env: {
      _abort_js: () => { throw new Error('wasm abort') },
      emscripten_resize_heap: () => false,
      fd_close: () => 8,
      fd_seek: () => 70,
      fd_write: () => 0,
    },
    wasi_snapshot_preview1: {
      fd_close: () => 8,
      fd_seek: () => 70,
      fd_write: () => 0,
    },
  }

  const instance = await WebAssembly.instantiate(wasmModule, imports)

  wasmExports = instance.exports

  // 初始化内存视图
  const buffer = wasmExports.memory.buffer
  HEAP16 = new Int16Array(buffer)

  // 调用 __wasm_call_ctors（Emscripten 必须）
  if (wasmExports.__wasm_call_ctors) {
    wasmExports.__wasm_call_ctors()
  }

  // 分配 UTF-16 缓冲区
  ptrBuf = wasmExports.malloc(MAX_STRING_LEN * 2 + 7)
  if (ptrBuf % 2) ptrBuf++
}

function stringToUTF16(str, ptr, maxBytes) {
  const maxChars = Math.floor((maxBytes - 2) / 2)
  const len = Math.min(str.length, maxChars)
  for (let i = 0; i < len; i++) {
    HEAP16[(ptr >> 1) + i] = str.charCodeAt(i)
  }
  HEAP16[(ptr >> 1) + len] = 0
}

function beginChunk(maxDist, maxCosine, trimPinyin, crossMode) {
  wasmExports.begin_chunk(ptrBuf, maxDist, maxCosine, trimPinyin ? 1 : 0, crossMode ? 1 : 0)
}

function detectSimilarity(str, mode, indexL) {
  stringToUTF16(str, ptrBuf, MAX_STRING_LEN * 2)
  const ret = wasmExports.check_similar(mode, indexL)
  if (ret === 0) return null
  const unsigned = ret >>> 0
  const reason = unsigned >>> 30
  const dist = (unsigned >>> 19) & ((1 << 11) - 1)
  const idxDiff = unsigned & ((1 << 19) - 1)
  const REASON = ['==', 'edit', 'pinyin', 'cosine']
  return { reason: REASON[reason] || 'unknown', dist, idxDiff }
}

// ========== 预处理 ==========
const ENDING_CHARS = new Set('.。,，/?？!！…~～@^、+=-_♂♀ ')
const TRIM_EXTRA_SPACE_RE = /[ \u3000]+/g
const TRIM_CJK_SPACE_RE = /([\u3000-\u9FFF\uFF00-\uFFEF]) (?=[\u3000-\u9FFF\uFF00-\uFFEF])/g
const WIDTH_ENTRIES = [
  ['\u3000', ' '],
  ['１', '1'], ['２', '2'], ['３', '3'], ['４', '4'], ['５', '5'],
  ['６', '6'], ['７', '7'], ['８', '8'], ['９', '9'], ['０', '0'],
  ['！', '!'], ['＠', '@'], ['＃', '#'], ['＄', '$'], ['％', '%'],
  ['＾', '^'], ['＆', '&'], ['＊', '*'], ['（', '('], ['）', ')'],
  ['－', '-'], ['＝', '='], ['＿', '_'], ['＋', '+'], ['［', '['],
  ['］', ']'], ['｛', '{'], ['｝', '}'], ['；', ';'], ['：', ':'],
  ['，', ','], ['．', '.'], ['／', '/'], ['＜', '<'], ['＞', '>'],
  ['？', '?'], ['｜', '|'], ['～', '~'],
  ['ｑ', 'q'], ['ｗ', 'w'], ['ｅ', 'e'], ['ｒ', 'r'], ['ｔ', 't'],
  ['ｙ', 'y'], ['ｕ', 'u'], ['ｉ', 'i'], ['ｏ', 'o'], ['ｐ', 'p'],
  ['ａ', 'a'], ['ｓ', 's'], ['ｄ', 'd'], ['ｆ', 'f'], ['ｇ', 'g'],
  ['ｈ', 'h'], ['ｊ', 'j'], ['ｋ', 'k'], ['ｌ', 'l'], ['ｚ', 'z'],
  ['ｘ', 'x'], ['ｃ', 'c'], ['ｖ', 'v'], ['ｂ', 'b'], ['ｎ', 'n'],
  ['ｍ', 'm'],
  ['Ｑ', 'Q'], ['Ｗ', 'W'], ['Ｅ', 'E'], ['Ｒ', 'R'], ['Ｔ', 'T'],
  ['Ｙ', 'Y'], ['Ｕ', 'U'], ['Ｉ', 'I'], ['Ｏ', 'O'], ['Ｐ', 'P'],
  ['Ａ', 'A'], ['Ｓ', 'S'], ['Ｄ', 'D'], ['Ｆ', 'F'], ['Ｇ', 'G'],
  ['Ｈ', 'H'], ['Ｊ', 'J'], ['Ｋ', 'K'], ['Ｌ', 'L'], ['Ｚ', 'Z'],
  ['Ｘ', 'X'], ['Ｃ', 'C'], ['Ｖ', 'V'], ['Ｂ', 'B'], ['Ｎ', 'N'],
  ['Ｍ', 'M'],
]
const WIDTH_TABLE = new Map(WIDTH_ENTRIES)
const DEFAULT_FORCELIST = [[/^23{2,}$/, '23333'], [/^6{3,}$/, '66666']]

function preprocess(text) {
  if (!text || typeof text !== 'string') return text
  let len = text.length
  while (len > 0 && ENDING_CHARS.has(text.charAt(len - 1))) len--
  if (len === 0) len = text.length
  let result = ''
  for (let i = 0; i < len; i++) {
    const c = text.charAt(i)
    result += WIDTH_TABLE.get(c) || c
  }
  result = result.replace(TRIM_EXTRA_SPACE_RE, ' ').replace(TRIM_CJK_SPACE_RE, '$1')
  for (const [pattern, replacement] of DEFAULT_FORCELIST) {
    if (pattern.test(result)) { result = result.replace(pattern, replacement); break }
  }
  return result
}

// ========== 弹幕合并 ==========
function selectMedianLength(strs) {
  if (strs.length === 1) return strs[0]
  const sorted = [...strs].sort((a, b) => a.length - b.length)
  return sorted[Math.floor(sorted.length / 2)]
}

const CHUNK_SIZE = 5000

function processChunk(chunkItems, opts) {
  const { threshold, maxDist, maxCosine } = opts
  const THRESHOLD_MS = threshold * 1000
  beginChunk(maxDist, maxCosine, true, true)
  const storage = []
  let indexL = 0, indexR = 0
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
      } else {
        storage[indexR] = { timeMs: dmTimeMs, items: [dm] }
        indexR++
      }
    } else {
      storage[indexR] = { timeMs: dmTimeMs, items: [dm] }
      indexR++
    }
  }
  return storage
}

function mergeDanmuku(danmuku, options = {}) {
  const { threshold = 30, maxDist = 5, maxCosine = 45 } = options
  if (!danmuku || danmuku.length === 0) return []
  const sorted = [...danmuku].sort((a, b) => (a.time || 0) - (b.time || 0))
  const opts = { threshold, maxDist, maxCosine }
  const allClusters = []
  for (let start = 0; start < sorted.length; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, sorted.length)
    const chunk = sorted.slice(start, end)
    const clusters = processChunk(chunk, opts)
    for (let i = 0; i < clusters.length; i++) allClusters.push(clusters[i])
  }
  const result = []
  for (let i = 0; i < allClusters.length; i++) {
    const cluster = allClusters[i]
    if (cluster.items.length === 1) {
      const dm = { ...cluster.items[0] }
      delete dm._normalizedText
      result.push(dm)
    } else {
      const textCounts = new Map()
      for (const item of cluster.items) {
        const t = item._normalizedText || item.text
        textCounts.set(t, (textCounts.get(t) || 0) + 1)
      }
      let maxCount = 0
      for (const [, count] of textCounts) { if (count > maxCount) maxCount = count }
      const chosenText = selectMedianLength(
        [...textCounts.entries()].filter(([, c]) => c === maxCount).map(([t]) => t),
      )
      const times = cluster.items.map(d => d.time || 0).sort((a, b) => a - b)
      const mid = Math.floor(times.length / 2)
      const medianTime = times.length % 2 === 0 ? (times[mid - 1] + times[mid]) / 2 : times[mid]
      const repr = { ...cluster.items[0], time: medianTime, text: chosenText, _mergeCount: cluster.items.length }
      delete repr._normalizedText
      result.push(repr)
    }
  }
  return result
}

// ========== 消息分发 ==========
onmessage = async (event) => {
  const { data } = event
  if (!data.id && data.id !== 0) return

  if (data.type === 'init') {
    try {
      await initWasm(data.wasmUrl)
      globalThis.postMessage({ ready: true, id: data.id })
    } catch (e) {
      globalThis.postMessage({ error: e.message, id: data.id })
    }
  }
  else if (data.type === 'process') {
    try {
      const { items, options } = data
      // 预处理
      if (options.preprocess) {
        for (let i = 0; i < items.length; i++) {
          const dm = items[i]
          if (dm && dm.text) dm._normalizedText = preprocess(dm.text)
        }
      }
      // 合并
      let result = items
      if (options.merge && items.length > 0 && wasmExports) {
        result = mergeDanmuku(items, options)
      }
      globalThis.postMessage({ result, id: data.id })
    } catch (e) {
      globalThis.postMessage({ error: e.message, id: data.id })
    }
  }
}
