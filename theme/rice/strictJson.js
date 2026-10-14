/**
 * Bounded, strict JSON parser for untrusted RICE data (stored presets, imported pywal files).
 *
 * Unlike JSON.parse it rejects duplicate keys (which JSON.parse silently collapses), prototype-mutating keys
 * (`__proto__`, `prototype`, `constructor`) at any depth, and input over the configured size, depth, member and
 * string limits. Objects are plain objects with own data properties.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const DEFAULT_LIMITS = Object.freeze({ maxBytes: 1024 * 1024, maxDepth: 8, maxMembers: 8192, maxString: 64 * 1024, maxArray: 8192 })

class StrictJsonError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StrictJsonError'
  }
}

function utf8Length(text) {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

/**
 * @param {string} text
 * @param {Partial<typeof DEFAULT_LIMITS>} [limits]
 * @returns {*} the parsed value; throws StrictJsonError
 */
function parseStrictJson(text, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits }
  if (typeof text !== 'string') throw new StrictJsonError('not text')
  if (text.length > L.maxBytes || utf8Length(text) > L.maxBytes) throw new StrictJsonError('too large')
  let i = 0
  let members = 0
  const fail = (what) => {
    throw new StrictJsonError(`${what} at ${i}`)
  }
  const ws = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++
  }
  const count = () => {
    if (++members > L.maxMembers) fail('too many members')
  }

  function string() {
    if (text[i] !== '"') fail('expected string')
    i++
    let out = ''
    while (true) {
      if (i >= text.length) fail('unterminated string')
      const ch = text[i]
      if (ch === '"') {
        i++
        return out
      }
      if (ch.charCodeAt(0) < 0x20) fail('control character in string')
      if (ch === '\\') {
        const esc = text[i + 1]
        if (Object.prototype.hasOwnProperty.call(ESCAPES, esc)) {
          out += ESCAPES[esc]
          i += 2
        } else if (esc === 'u') {
          const hex = text.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad unicode escape')
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
        } else fail('bad escape')
      } else {
        out += ch
        i++
      }
      if (out.length > L.maxString) fail('string too long')
    }
  }

  function number() {
    const match = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i, i + 64))
    if (!match) fail('bad value')
    i += match[0].length
    const n = Number(match[0])
    if (!Number.isFinite(n)) fail('non-finite number')
    return n
  }

  function value(depth) {
    if (depth > L.maxDepth) fail('too deep')
    ws()
    const ch = text[i]
    if (ch === '{') {
      i++
      const obj = {}
      const seen = new Set()
      ws()
      if (text[i] === '}') {
        i++
        return obj
      }
      while (true) {
        ws()
        const key = string()
        if (FORBIDDEN_KEYS.has(key)) fail('forbidden key')
        if (seen.has(key)) fail('duplicate key')
        seen.add(key)
        count()
        ws()
        if (text[i] !== ':') fail('expected colon')
        i++
        Object.defineProperty(obj, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true })
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return obj
        }
        fail('expected , or }')
      }
    }
    if (ch === '[') {
      i++
      const arr = []
      ws()
      if (text[i] === ']') {
        i++
        return arr
      }
      while (true) {
        arr.push(value(depth + 1))
        count()
        if (arr.length > L.maxArray) fail('array too long')
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return arr
        }
        fail('expected , or ]')
      }
    }
    if (ch === '"') return string()
    for (const [word, val] of [
      ['true', true],
      ['false', false],
      ['null', null]
    ]) {
      if (text.startsWith(word, i)) {
        i += word.length
        return val
      }
    }
    return number()
  }

  if (text.charCodeAt(0) === 0xfeff) i = 1 // optional UTF-8 BOM
  const result = value(1)
  ws()
  if (i !== text.length) fail('trailing data')
  return result
}

module.exports = { parseStrictJson, StrictJsonError, FORBIDDEN_KEYS, utf8Length }
