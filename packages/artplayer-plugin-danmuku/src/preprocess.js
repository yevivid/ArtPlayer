import {
  DEFAULT_FORCELIST,
  ENDING_CHARS,
  TRIM_CJK_SPACE_RE,
  TRIM_EXTRA_SPACE_RE,
  WIDTH_TABLE,
} from './preprocess-core.js'

export function createPreprocessor(options = {}) {
  const {
    trimEnding = true,
    trimSpace = true,
    trimWidth = true,
    forcelist = DEFAULT_FORCELIST,
  } = options

  return function preprocess(text) {
    if (!text || typeof text !== 'string') {
      return text
    }

    let len = text.length

    if (trimEnding) {
      while (len > 0 && ENDING_CHARS.has(text.charAt(len - 1)))
        len--
      if (len === 0) {
        len = text.length
      }
    }

    let result = ''
    if (trimWidth) {
      for (let i = 0; i < len; i++) {
        const c = text.charAt(i)
        result += WIDTH_TABLE.get(c) || c
      }
    }
    else {
      result = text.slice(0, len)
    }

    if (trimSpace) {
      result = result.replace(TRIM_EXTRA_SPACE_RE, ' ').replace(TRIM_CJK_SPACE_RE, '$1')
    }

    for (const [pattern, replacement] of forcelist) {
      if (pattern.test(result)) {
        result = result.replace(pattern, replacement)
        break
      }
    }

    return result
  }
}
