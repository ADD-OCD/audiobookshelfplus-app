// RICE palette parsers (theme/rice/import/parsers.js) and import mapping. Fixtures are synthetic, except the
// Adventure Time palette: the 15 literal #RRGGBB values of Colors/colors in ajfunk327/Adventure-Time-Dotfiles at
// 8d2b15732ecef786734cd5e96647f98e97d99088 (no repository-wide license; used only as numeric test data, with this
// attribution; no wallpapers, fonts, icons or styles from it are included).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const P = require('../theme/rice/import/parsers.js')
const { mapPalette } = require('../theme/rice/mapping.js')
const { evaluateContrast } = require('../theme/rice/contrast.js')
const S = require('../theme/rice/schema.js')
const { toHex } = require('../theme/rice/color.js')

const ADVENTURE_TIME = ['#172126', '#FF7D86', '#FC9E8A', '#FEBBA2', '#FCCB96', '#FC9E8A', '#F5E9C8', '#FEBBA2', '#FCCB96', '#D2FCE4', '#67BDB0', '#568E81', '#113B35', '#172126', '#F5E9C8']

const code = (fn) => {
  try {
    fn()
  } catch (e) {
    return e.code
  }
  return 'accepted'
}

const pywal = (patch = {}) =>
  JSON.stringify({
    wallpaper: '/home/user/wall.png',
    alpha: '100',
    special: { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc' },
    colors: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`color${i}`, '#' + (i * 0x0f0f0f + 0x101010).toString(16).padStart(6, '0').slice(-6)])),
    ...patch
  })

test('hex list: the Adventure Time palette parses with source order and duplicates kept; roles need confirmation', () => {
  const c = P.parseHexList(ADVENTURE_TIME.join('\n') + '\n')
  assert.equal(c.format, 'hex-list-v1')
  assert.equal(c.slots.length, 15)
  assert.deepEqual(c.slots.map(toHex), ADVENTURE_TIME)
  assert.equal(new Set(c.slots.map(toHex)).size, 10, '10 distinct colors')
  assert.equal(c.needsRoles, true)
  assert.equal(
    code(() => P.parseHexList([...ADVENTURE_TIME, ...ADVENTURE_TIME].slice(0, 25).join('\n'))),
    'too-many-colors'
  )
  assert.equal(
    code(() => P.parseHexList('#172126\n#FF7D8')),
    'not-a-hex-list'
  )
  assert.equal(
    code(() => P.parseHexList('#172126 # comment\n#FF7D86')),
    'not-a-hex-list'
  )
  assert.equal(
    code(() => P.parseHexList('#172126')),
    'too-few-colors'
  )
})

test('Adventure Time worked example: user-chosen roles map to a readable dark palette with recorded adjustments', () => {
  const h = (hex) => P.parseHexList(`${hex}\n#000000`).slots[0]
  const { snapshot, adjustments, unresolved } = mapPalette({ background: h('#172126'), raised: h('#113B35'), foreground: h('#F5E9C8'), accent: h('#FF7D86'), progress: h('#FEBBA2') })
  assert.ok(S.validateSnapshot(snapshot).ok)
  assert.ok(evaluateContrast(snapshot).ok)
  assert.deepEqual(unresolved, [])
  assert.equal(snapshot.colorScheme, 'dark')
  assert.equal(toHex(snapshot.tokens['surface.base']), '#172126')
  assert.equal(toHex(snapshot.tokens['text.primary']), '#F5E9C8')
  assert.equal(toHex(snapshot.tokens['accent.primary']), '#FF7D86')
  assert.equal(toHex(snapshot.tokens['progress.played']), '#FEBBA2')
  assert.ok(Array.isArray(adjustments))
})

test('pywal JSON: generated shape accepted; templates, unknown keys, duplicates and prototype keys rejected', () => {
  const c = P.parsePywal(pywal())
  assert.equal(c.format, 'pywal-json-v1')
  assert.equal(toHex(c.roles.background), '#1E1E2E')
  assert.equal(c.slots.length, 18)
  assert.equal(
    code(() => P.parsePywal(pywal({ special: { background: '{color0}', foreground: '#ffffff' } }))),
    'bad-color'
  )
  assert.equal(
    code(() => P.parsePywal(pywal({ extra: 1 }))),
    'unsupported-key'
  )
  assert.equal(
    code(() => P.parsePywal(pywal({ special: { background: '#000000', foreground: '#ffffff', url: 'x' } }))),
    'unsupported-key'
  )
  assert.equal(
    code(() => P.parsePywal(pywal({ wallpaper: { path: '/etc/passwd' } }))),
    'bad-metadata'
  )
  assert.equal(
    code(() => P.parsePywal('{"special":{},"special":{}}')),
    'bad-json'
  )
  assert.equal(
    code(() => P.parsePywal('{"__proto__":{"polluted":1}}')),
    'bad-json'
  )
  assert.equal({}.polluted, undefined)
  const fifteen = JSON.parse(pywal())
  delete fifteen.colors.color15
  assert.equal(
    code(() => P.parsePywal(JSON.stringify(fifteen))),
    'need-16-colors'
  )
})

test('Kitty: literal colors and comments accepted; includes, commands, non-literal values and duplicates rejected', () => {
  const text = ['# vim:ft=kitty', '## name: Synthetic Night', '## author: Test', 'background #1a1b26', 'foreground #c0caf5', 'selection_background #283457', 'color4 #7aa2f7', 'color6 #7dcfff', 'url_color #73daca'].join('\n')
  const c = P.parseKitty(text)
  assert.equal(c.format, 'kitty-colors-v1')
  assert.equal(c.name, 'Synthetic Night')
  assert.equal(toHex(c.roles.accent), '#7AA2F7')
  assert.equal(
    code(() => P.parseKitty(text + '\ninclude other.conf')),
    'unsupported-directive'
  )
  assert.equal(
    code(() => P.parseKitty(text + '\nmap ctrl+c copy')),
    'unsupported-directive'
  )
  assert.equal(
    code(() => P.parseKitty(text + '\nenvinclude KITTY_*')),
    'unsupported-directive'
  )
  assert.equal(
    code(() => P.parseKitty(text + '\ncursor_text_color background')),
    'bad-color'
  )
  assert.equal(
    code(() => P.parseKitty(text + '\nbackground #000000')),
    'duplicate-key'
  )
  assert.equal(
    code(() => P.parseKitty(text + '\ntab_bar_style fade')),
    'unsupported-key'
  )
  assert.equal(
    code(() => P.parseKitty('foreground #ffffff')),
    'missing-background-or-foreground'
  )
  assert.equal(
    code(() => P.parseKitty('background $(curl evil)\nforeground #ffffff')),
    'bad-line'
  )
})

test('Base16 (legacy flat) and Base24 (current palette map): leading zeros stay text; YAML features rejected', () => {
  const legacy = ['scheme: "Synthetic"', 'author: "Test"', ...Array.from({ length: 16 }, (_, i) => `base0${i.toString(16).toUpperCase()}: "0${i.toString(16)}0a0b" # comment`)].join('\n')
  const c = P.parseBasePalette(legacy)
  assert.equal(c.format, 'base-palette-v1')
  assert.equal(toHex(c.slots[0]), '#000A0B', 'leading zeros preserved')
  assert.equal(c.name, 'Synthetic')
  const slots = Array.from({ length: 24 }, (_, i) => `  base${i.toString(16).toUpperCase().padStart(2, '0')}: "${(0x101010 + i * 0x050505).toString(16)}"`)
  const current = ['system: "base24"', 'name: "Synthetic 24"', 'author: "Test"', 'variant: "dark"', 'palette:', ...slots].join('\n')
  const c24 = P.parseBasePalette(current)
  assert.equal(c24.slots.length, 24)
  assert.equal(c24.variant, 'dark')
  const base16 = ['system: "base16"', 'name: "X"', 'author: "Y"', 'palette:', ...slots.slice(0, 16)].join('\n')
  assert.equal(P.parseBasePalette(base16).slots.length, 16)
  for (const [name, bad, expected] of [
    ['anchor', base16.replace('  base00: "101010"', '  base00: &a "101010"'), 'unsupported-yaml'],
    ['alias', base16.replace('  base01: "151515"', '  base01: *a'), 'unsupported-yaml'],
    ['tag', base16.replace('  base02: "1a1a1a"', '  base02: !!str 1a1a1a'), 'unsupported-yaml'],
    ['flow map', base16.replace('palette:', 'palette: { base00: "000000" }'), 'unsupported-yaml'],
    ['merge key', base16 + '\n  <<: *a', 'bad-line'],
    ['block scalar', base16.replace('name: "X"', 'name: |'), 'unsupported-yaml'],
    ['unquoted #', base16.replace('  base03: "1f1f1f"', '  base03: #1f1f1f'), 'bad-value'],
    ['wrong count', base16.replace(/\n {2}base0F.*$/, ''), 'wrong-slot-count'],
    ['duplicate', base16 + '\n  base00: "000000"', 'duplicate-key'],
    ['unknown key', 'command: "rm -rf /"\n' + base16, 'unsupported-key'],
    ['bad system', base16.replace('base16', 'base32'), 'unsupported-system']
  ])
    assert.equal(
      code(() => P.parseBasePalette(bad)),
      expected,
      name
    )
})

test('shared limits: size, line length, NUL; detection uses content, not file names', () => {
  assert.equal(
    code(() => P.parseHexList('#000000\n'.repeat(9000))),
    'too-large'
  )
  assert.equal(
    code(() => P.parseKitty('background #000000 ' + 'x'.repeat(600))),
    'line-too-long'
  )
  assert.equal(
    code(() => P.parseHexList('#000000\n\u0000#ffffff')),
    'binary'
  )
  assert.equal(P.detectAndParse(pywal()).format, 'pywal-json-v1')
  assert.equal(P.detectAndParse(ADVENTURE_TIME.join('\n')).format, 'hex-list-v1')
  assert.equal(P.detectAndParse('background #000000\nforeground #ffffff').format, 'kitty-colors-v1')
  for (const unsupported of ['@define-color bg #000000;', '* { background: #000; }', '#!/bin/sh\nwal -i x', 'window { background-color: @bg; }', '[colors]\nbackground = #000000']) {
    assert.equal(
      code(() => P.detectAndParse(unsupported)),
      'unsupported-format',
      unsupported
    )
  }
})

test('mapped imports are complete, validated snapshots; light/dark comes from the palette', () => {
  for (const c of [P.parsePywal(pywal()), P.parseKitty('background #fdf6e3\nforeground #657b83\ncolor4 #268bd2')]) {
    const { snapshot } = mapPalette({ ...Object.fromEntries(Object.entries(c.roles).filter(([, v]) => v)) })
    assert.ok(S.validateSnapshot(snapshot).ok)
    assert.ok(evaluateContrast(snapshot).ok)
    assert.equal(snapshot.colorScheme, P.candidateScheme(c))
  }
})
