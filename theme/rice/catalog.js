/**
 * RICE starter catalog: ten read-only adaptations of established palettes (docs/rice-customization.md).
 *
 * Shown only while RICE is enabled; never added to BUILTIN_THEMES. Each entry is static source data pinned to an
 * inspected upstream commit and file. The five anchor colors were read from that file (never by running theme
 * scripts); the rest of the app palette is derived by the deterministic mapper, and every adjustment it makes for
 * contrast is recorded. tests/rice-catalog.test.mjs pins the resulting snapshots, so any change to the mapper or the
 * anchors shows up as a reviewed fixture change. License/notice texts ship in static/licenses/rice/.
 * Palette adaptations only: no logos, fonts or screenshots, and no claim of endorsement or a pixel-perfect port.
 */
const { parseHex } = require('./color')
const { mapPalette } = require('./mapping')
const { deepFreeze, STARTER_IDS } = require('./schema')

const CATALOG_VERSION = 1

const h = (hex) => parseHex('#' + hex)

// background, raised surface, primary text, accent, progress: the source anchors (FEATURE-SPEC starter table)
const SOURCES = [
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', anchors: ['1E1E2E', '313244', 'CDD6F4', 'CBA6F7', 'F9E2AF'], project: 'catppuccin/palette', commit: '07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd', file: 'palette.json', license: 'MIT', notices: ['catppuccin-palette-LICENSE.txt'] },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', anchors: ['EFF1F5', 'CCD0DA', '4C4F69', '8839EF', 'DF8E1D'], project: 'catppuccin/palette', commit: '07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd', file: 'palette.json', license: 'MIT', notices: ['catppuccin-palette-LICENSE.txt'] },
  { id: 'dracula', name: 'Dracula', anchors: ['282A36', '44475A', 'F8F8F2', 'BD93F9', 'FFB86C'], project: 'dracula/dracula-theme', commit: 'e22ebcc048b8aff586f9bc94db30ff5347070b42', file: 'README.md', license: 'MIT', notices: ['dracula-theme-LICENSE.txt'], note: 'The open-source Dracula palette, not Dracula PRO.' },
  { id: 'nord', name: 'Nord', anchors: ['2E3440', '3B4252', 'D8DEE9', '88C0D0', 'EBCB8B'], project: 'nordtheme/nord', commit: '1cef71605416a222e57225b544540ce0fcec18d4', file: 'src/nord.scss', license: 'MIT', notices: ['nord-LICENSE.txt'] },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    anchors: ['282828', '3C3836', 'EBDBB2', '83A598', 'FABD2F'],
    project: 'morhetz/gruvbox',
    commit: 'ef8864bb42bf244f0295d1c5a403b27e3d139695',
    file: 'colors/gruvbox.vim',
    license: 'MIT/X11 (declared in README)',
    notices: ['gruvbox-license-declaration.txt'],
    note: 'The project README declares MIT/X11; the repository has no root license file. Medium contrast variant.'
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    anchors: ['1A1B26', '292E42', 'C0CAF5', '7AA2F7', 'E0AF68'],
    project: 'folke/tokyonight.nvim',
    commit: 'cdc07ac78467a233fd62c493de29a17e0cf2b2b6',
    file: 'extras/kitty/tokyonight_night.conf',
    license: 'Apache-2.0 (repository); MIT (exported Kitty file header)',
    notices: ['tokyonight-nvim-LICENSE.txt', 'tokyonight-kitty-export-notice.txt'],
    note: 'Night variant.'
  },
  { id: 'rose-pine', name: 'Rosé Pine', anchors: ['191724', '1F1D2E', 'E0DEF4', 'C4A7E7', 'F6C177'], project: 'rose-pine/rose-pine-palette', commit: '92af52b465ab6e47437aca223c9b8d3009a2023b', file: 'dist/css/rose-pine.css', license: 'MIT', notices: ['rose-pine-palette-LICENSE.txt'], note: 'Main variant.' },
  { id: 'solarized-dark', name: 'Solarized Dark', anchors: ['002B36', '073642', '839496', '268BD2', 'B58900'], project: 'altercation/solarized', commit: '62f656a02f93c5190a8753159e34b385588d5ff3', file: 'README.md', license: 'MIT', notices: ['solarized-LICENSE.txt'] },
  { id: 'solarized-light', name: 'Solarized Light', anchors: ['FDF6E3', 'EEE8D5', '657B83', '268BD2', 'B58900'], project: 'altercation/solarized', commit: '62f656a02f93c5190a8753159e34b385588d5ff3', file: 'README.md', license: 'MIT', notices: ['solarized-LICENSE.txt'] },
  { id: 'everforest-dark', name: 'Everforest Dark', anchors: ['2D353B', '343F44', 'D3C6AA', 'A7C080', 'DBBC7F'], project: 'sainnhe/everforest', commit: '85a86eb62409e3ec88713bff3d1b9d7374e112e4', file: 'autoload/everforest.vim', license: 'MIT', notices: ['everforest-LICENSE.txt'], note: 'Medium contrast variant.' }
]

const STARTERS = deepFreeze(
  SOURCES.map((source) => {
    const [background, raised, foreground, accent, progress] = source.anchors.map(h)
    const { snapshot, adjustments, unresolved } = mapPalette({ background, raised, foreground, accent, progress })
    return {
      id: source.id,
      name: source.name,
      snapshot,
      adjustments,
      unresolved,
      attribution: {
        project: `https://github.com/${source.project}`,
        source: `https://github.com/${source.project}/blob/${source.commit}/${source.file}`,
        commit: source.commit,
        license: source.license,
        notices: source.notices.map((file) => `/licenses/rice/${file}`),
        note: source.note || null
      }
    }
  })
)

if (STARTERS.map((s) => s.id).join() !== STARTER_IDS.join()) throw new Error('RICE starter catalog and STARTER_IDS disagree')

const getStarter = (id) => STARTERS.find((s) => s.id === id) || null

module.exports = { STARTERS, CATALOG_VERSION, getStarter }
