let module = null
let ptr_buf = null

const MAX_STRING_LEN = 16005

export async function initSimilarity(wasmUrl) {
  const generatedModule = (await import('./similarity-gen.js')).default
  const resp = await fetch(wasmUrl)
  const wasmBinary = await resp.arrayBuffer()
  module = await generatedModule({ wasm: wasmBinary })
  ptr_buf = module._malloc(MAX_STRING_LEN * 2 + 7)
  if (ptr_buf % 2) {
    ptr_buf++
  }
  return module
}

export function beginChunk(maxDist, maxCosine, trimPinyin, crossMode) {
  if (!module)
    throw new Error('WASM not initialized')
  module._begin_chunk(ptr_buf, maxDist, maxCosine, trimPinyin, crossMode)
}

export function beginIndexLock() {
  if (!module)
    throw new Error('WASM not initialized')
  module._begin_index_lock()
}

export function detectSimilarity(str, mode, indexL) {
  if (!module)
    throw new Error('WASM not initialized')

  module.stringToUTF16(str, ptr_buf, MAX_STRING_LEN * 2)

  const ret = module._check_similar(mode, indexL)
  if (ret === 0)
    return null

  const unsigned = ret >>> 0
  const reason = unsigned >>> 30
  const dist = (unsigned >>> 19) & ((1 << 11) - 1)
  const idxDiff = unsigned & ((1 << 19) - 1)

  const REASON = ['==', 'edit', 'pinyin', 'cosine']
  return { reason: REASON[reason] || 'unknown', dist, idxDiff }
}
