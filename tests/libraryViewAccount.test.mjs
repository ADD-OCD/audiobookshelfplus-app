import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const toModule = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').then((s) => s.replace(/\r\n/g, '\n'))
const util = await toModule(await read('../utils/libraryViewState.js'))
const { activateViewScope, emptyViewState, parseLibraryViewScopes, planViewSwitch, serializeLibraryViewScopes, viewScopeKey } = util

// ---- account isolation (utils/libraryViewState.js)

test('viewScopeKey tells servers and accounts apart and needs both parts', () => {
  const a = viewScopeKey('conn-1', 'user-a')
  assert.notEqual(a, viewScopeKey('conn-1', 'user-b'), 'two accounts on one server')
  assert.notEqual(a, viewScopeKey('conn-2', 'user-a'), 'the same user id on another saved connection (legacy ids such as "root")')
  assert.equal(a, viewScopeKey('conn-1', 'user-a'), 'the same account signing in again')
  for (const [conn, user] of [[null, 'u'], ['c', null], ['', 'u'], ['c', ''], [undefined, undefined], [1, 2]]) assert.equal(viewScopeKey(conn, user), null)
})

// A user's view of two libraries, as left behind by a visit
const bookView = { tab: 'bookshelf-series', mobileOrderBy: 'media.metadata.title', mobileOrderDesc: false, mobileFilterBy: 'all' }

test('two accounts on one server keep separate memories', () => {
  const settingsA = { mobileOrderBy: 'media.duration', mobileOrderDesc: true, mobileFilterBy: 'progress.finished' }
  // account A is active and owns the live settings of library L1
  const a = activateViewScope({ scopes: {}, scope: null, viewState: emptyViewState() }, 'c|A', settingsA)
  assert.deepEqual(a.viewState, emptyViewState(), 'a new account starts empty (first run takes the live settings)')
  const aState = { owner: 'L1', libraries: { L1: { tab: 'bookshelf-library' }, L2: bookView } }
  // switching to account B snapshots A's live settings under A's owner library and hands B its own memory
  const b = activateViewScope({ scopes: a.scopes, scope: 'c|A', viewState: aState }, 'c|B', settingsA)
  assert.equal(b.scope, 'c|B')
  assert.deepEqual(b.viewState.libraries, {}, 'B sees none of A\'s tabs, sorts or filters')
  assert.equal(b.viewState.resetSettings, true)
  assert.deepEqual(b.scopes['c|A'].libraries.L1, { tab: 'bookshelf-library', mobileOrderBy: 'media.duration', mobileOrderDesc: true, mobileFilterBy: 'progress.finished' })
  assert.equal(b.scopes['c|A'].owner, null, 'A no longer owns the global settings')
  // B's first fetch: nothing saved, so the filter is reset (A's filter may not exist for B)
  const plan = planViewSwitch(b.viewState, 'L1', settingsA)
  assert.deepEqual(plan.settingsUpdate, { mobileFilterBy: 'all' })
  assert.equal(plan.state.owner, 'L1')
  assert.equal('resetSettings' in plan.state, false)
  // back to A: A's saved view of the library is applied again
  const bState = { owner: 'L1', libraries: { L1: { tab: 'bookshelf' } } }
  const back = activateViewScope({ scopes: b.scopes, scope: 'c|B', viewState: bState }, 'c|A', { mobileOrderBy: 'addedAt', mobileOrderDesc: true, mobileFilterBy: 'all' })
  assert.equal(back.scope, 'c|A')
  assert.equal(back.viewState.libraries.L1.tab, 'bookshelf-library')
  assert.deepEqual(planViewSwitch(back.viewState, 'L1', {}).settingsUpdate, { mobileOrderBy: 'media.duration', mobileOrderDesc: true, mobileFilterBy: 'progress.finished' })
  assert.equal(back.scopes['c|B'].libraries.L1.tab, 'bookshelf', 'B kept its own')
})

test('a library with identical ids on two servers never shares a memory', () => {
  const state = { owner: 'LIB', libraries: { LIB: { tab: 'bookshelf-series' } } }
  const other = activateViewScope({ scopes: {}, scope: 'serverOne|u1', viewState: state }, 'serverTwo|u1', {})
  assert.deepEqual(other.viewState.libraries, {})
})

test('signing out and in to the same account keeps the memory (same scope: nothing is reset)', () => {
  const scope = viewScopeKey('c', 'u')
  const state = { owner: 'L1', libraries: { L1: bookView } }
  // the store skips activation when the scope is unchanged; activating the same scope again must not lose anything either
  const again = activateViewScope({ scopes: {}, scope, viewState: state }, scope, { mobileOrderBy: 'x' })
  assert.equal(again.scope, scope)
  assert.equal(again.viewState.libraries.L1.tab, 'bookshelf-series')
})

test('signing out leaves no active memory, and the account gets its memory back on the next sign-in', () => {
  const state = { owner: 'L1', libraries: { L1: bookView } }
  const out = activateViewScope({ scopes: {}, scope: 'c|u', viewState: state }, null, { mobileOrderBy: 'addedAt', mobileOrderDesc: true, mobileFilterBy: 'all' })
  assert.equal(out.scope, null)
  assert.deepEqual(out.viewState, emptyViewState())
  assert.ok(out.scopes['c|u'], 'the account\'s memory is kept')
  const inAgain = activateViewScope({ scopes: out.scopes, scope: null, viewState: out.viewState }, 'c|u', {})
  assert.equal(inAgain.viewState.libraries.L1.tab, 'bookshelf-series')
})

test('persistence: serialize/parse round trip, restart, and invalid stored data', () => {
  const active = { owner: 'L1', libraries: { L1: { tab: 'bookshelf-library', mobileOrderBy: 'addedAt' } }, resetSettings: true }
  const raw = serializeLibraryViewScopes({ 'c|other': { owner: null, libraries: { X: { tab: 'bookshelf' } } } }, 'c|me', active)
  const stored = JSON.parse(raw)
  assert.equal(stored.version, 2)
  assert.deepEqual(Object.keys(stored.scopes).sort(), ['c|me', 'c|other'])
  assert.equal('resetSettings' in stored.scopes['c|me'], false, 'transient flags are not stored')
  // a restart: the active account's memory comes back as saved
  const scopes = parseLibraryViewScopes(raw)
  const restarted = activateViewScope({ scopes, scope: null, viewState: emptyViewState() }, 'c|me', {})
  assert.equal(restarted.viewState.owner, 'L1', 'a cold start keeps the owner: the live settings are still its own')
  assert.equal('resetSettings' in restarted.viewState, false)
  for (const bad of [null, 'nope', '{}', '[]', '{"version":1,"scopes":{"a":{}}}', '{"version":2,"scopes":[]}', '{"version":2,"scopes":{"a":"x","":{"owner":"L"},"b":{"libraries":{"L":{"tab":"evil"}}}}}']) {
    assert.deepEqual(parseLibraryViewScopes(bad), {}, String(bad))
  }
  assert.equal(serializeLibraryViewScopes({}, null, emptyViewState()), '{"version":2,"scopes":{}}')
})

test('legacy memory goes to one unambiguous account and is otherwise left alone', () => {
  const legacy = { owner: 'L1', libraries: { L1: { tab: 'bookshelf-series', mobileOrderBy: 'addedAt' } } }
  const claimed = activateViewScope({ scopes: {}, scope: null, viewState: emptyViewState() }, 'c|me', {}, { legacy, claimLegacy: true })
  assert.equal(claimed.legacyClaimed, true)
  assert.equal(claimed.viewState.owner, 'L1', 'the live settings still belong to the legacy owner')
  assert.equal(claimed.viewState.libraries.L1.tab, 'bookshelf-series')
  // ambiguous: another account on the device must not see it
  const ambiguous = activateViewScope({ scopes: {}, scope: null, viewState: emptyViewState() }, 'c|me', {}, { legacy, claimLegacy: false })
  assert.equal(ambiguous.legacyClaimed, false)
  assert.deepEqual(ambiguous.viewState, emptyViewState())
  // an account with a memory of its own does not take the legacy one
  const own = { 'c|me': { owner: null, libraries: { L9: { tab: 'bookshelf' } } } }
  const kept = activateViewScope({ scopes: own, scope: null, viewState: emptyViewState() }, 'c|me', {}, { legacy, claimLegacy: true })
  assert.equal(kept.legacyClaimed, false)
  assert.equal(kept.viewState.libraries.L9.tab, 'bookshelf')
  // no identity (no scope): nothing is activated and nothing is claimed
  const none = activateViewScope({ scopes: {}, scope: null, viewState: emptyViewState() }, null, {}, { legacy, claimLegacy: true })
  assert.equal(none.legacyClaimed, false)
  assert.equal(none.scope, null)
  // an empty or invalid legacy memory is not claimed
  assert.equal(activateViewScope({ scopes: {}, scope: null, viewState: emptyViewState() }, 'c|me', {}, { legacy: emptyViewState(), claimLegacy: true }).legacyClaimed, false)
})

test('planViewSwitch: first run still takes the live settings, a returning memory applies its saved view', () => {
  assert.deepEqual(planViewSwitch(emptyViewState(), 'L1', { mobileOrderBy: 'x' }), { state: { owner: 'L1', libraries: {} }, settingsUpdate: null })
  const returning = { owner: null, libraries: { L1: { tab: 'bookshelf', mobileOrderBy: 'media.duration', mobileFilterBy: 'all' } } }
  assert.deepEqual(planViewSwitch(returning, 'L1', {}).settingsUpdate, { mobileOrderBy: 'media.duration', mobileFilterBy: 'all' })
})

test('the store activates the account memory before it fetches and records tabs only with an account', async () => {
  const source = await read('../store/libraries.js')
  const fetchBody = source.slice(source.indexOf('  fetch({'), source.indexOf('  // Switch from the library button'))
  assert.ok(fetchBody.indexOf("dispatch('activateViewScope')") > 0 && fetchBody.indexOf("dispatch('activateViewScope')") < fetchBody.indexOf('this.$nativeHttp'), 'activation precedes the request')
  assert.match(fetchBody, /state\.viewStateLoaded && state\.viewScope/, 'a view is applied only with an account')
  assert.match(source, /if \(!state\.viewStateLoaded \|\| !state\.viewScope \|\| !state\.currentLibraryId\) return/, 'rememberTab needs an account')
  const activate = source.slice(source.indexOf('  activateViewScope({'), source.indexOf('  // Writes only after loading'))
  assert.doesNotMatch(activate, /\bawait\b/, 'activation is synchronous (same tick as the library switch)')
  assert.match(activate, /serverConnectionConfigs\?\.length === 1/, 'the legacy memory is claimed only when the account is unambiguous')
})
