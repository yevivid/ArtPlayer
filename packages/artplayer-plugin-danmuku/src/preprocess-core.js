const ENDING_CHARS = new Set('.。,，/…~～@^、+=-_♂♀ ')
const TRIM_EXTRA_SPACE_RE = /[ \u3000]+/g
const TRIM_CJK_SPACE_RE = /([\u3000-\u9FFF\uFF00-\uFFEF]) (?=[\u3000-\u9FFF\uFF00-\uFFEF])/g

const WIDTH_ENTRIES = [
  ['\u3000', ' '],
  ['１', '1'],
  ['２', '2'],
  ['３', '3'],
  ['４', '4'],
  ['５', '5'],
  ['６', '6'],
  ['７', '7'],
  ['８', '8'],
  ['９', '9'],
  ['０', '0'],
  ['！', '!'],
  ['＠', '@'],
  ['＃', '#'],
  ['＄', '$'],
  ['％', '%'],
  ['＾', '^'],
  ['＆', '&'],
  ['＊', '*'],
  ['（', '('],
  ['）', ')'],
  ['－', '-'],
  ['＝', '='],
  ['＿', '_'],
  ['＋', '+'],
  ['［', '['],
  ['］', ']'],
  ['｛', '{'],
  ['｝', '}'],
  ['；', ';'],
  ['：', ':'],
  ['，', ','],
  ['．', '.'],
  ['／', '/'],
  ['＜', '<'],
  ['＞', '>'],
  ['？', '?'],
  ['｜', '|'],
  ['～', '~'],
  ['ｑ', 'q'],
  ['ｗ', 'w'],
  ['ｅ', 'e'],
  ['ｒ', 'r'],
  ['ｔ', 't'],
  ['ｙ', 'y'],
  ['ｕ', 'u'],
  ['ｉ', 'i'],
  ['ｏ', 'o'],
  ['ｐ', 'p'],
  ['ａ', 'a'],
  ['ｓ', 's'],
  ['ｄ', 'd'],
  ['ｆ', 'f'],
  ['ｇ', 'g'],
  ['ｈ', 'h'],
  ['ｊ', 'j'],
  ['ｋ', 'k'],
  ['ｌ', 'l'],
  ['ｚ', 'z'],
  ['ｘ', 'x'],
  ['ｃ', 'c'],
  ['ｖ', 'v'],
  ['ｂ', 'b'],
  ['ｎ', 'n'],
  ['ｍ', 'm'],
  ['Ｑ', 'Q'],
  ['Ｗ', 'W'],
  ['Ｅ', 'E'],
  ['Ｒ', 'R'],
  ['Ｔ', 'T'],
  ['Ｙ', 'Y'],
  ['Ｕ', 'U'],
  ['Ｉ', 'I'],
  ['Ｏ', 'O'],
  ['Ｐ', 'P'],
  ['Ａ', 'A'],
  ['Ｓ', 'S'],
  ['Ｄ', 'D'],
  ['Ｆ', 'F'],
  ['Ｇ', 'G'],
  ['Ｈ', 'H'],
  ['Ｊ', 'J'],
  ['Ｋ', 'K'],
  ['Ｌ', 'L'],
  ['Ｚ', 'Z'],
  ['Ｘ', 'X'],
  ['Ｃ', 'C'],
  ['Ｖ', 'V'],
  ['Ｂ', 'B'],
  ['Ｎ', 'N'],
  ['Ｍ', 'M'],
]
const WIDTH_TABLE = new Map(WIDTH_ENTRIES)
const DEFAULT_FORCELIST = [[/^23{2,}$/, '23333'], [/^6{3,}$/, '66666']]

function preprocessDefault(text) {
  if (!text || typeof text !== 'string')
    return text
  let len = text.length
  while (len > 0 && ENDING_CHARS.has(text.charAt(len - 1))) len--
  if (len === 0)
    len = text.length
  let result = ''
  for (let i = 0; i < len; i++) {
    const c = text.charAt(i)
    result += WIDTH_TABLE.get(c) || c
  }
  result = result.replace(TRIM_EXTRA_SPACE_RE, ' ').replace(TRIM_CJK_SPACE_RE, '$1')
  for (const [pattern, replacement] of DEFAULT_FORCELIST) {
    if (pattern.test(result)) {
      result = result.replace(pattern, replacement)
      break
    }
  }
  return result
}

export {
  DEFAULT_FORCELIST,
  ENDING_CHARS,
  preprocessDefault,
  TRIM_CJK_SPACE_RE,
  TRIM_EXTRA_SPACE_RE,
  WIDTH_ENTRIES,
  WIDTH_TABLE,
}
