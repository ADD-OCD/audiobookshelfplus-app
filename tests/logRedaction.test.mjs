import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { deviceDataSummary, serverConnectionConfigSummary } from '../utils/logSummary.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

// Synthetic credentials only
const token = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJzeW50aGV0aWMifQ.c3ludGhldGljc2ln'
const config = { id: 'c3ludGhldGljLWlk', index: 0, name: 'http://abs.example.com (syntheticuser)', address: 'http://abs.example.com', username: 'syntheticuser', token, version: '2.36.1' }

const assertNoCredentials = (text) => {
  for (const secret of [token, 'syntheticuser', 'abs.example.com', 'c3ludGhldGljLWlk']) assert.ok(!text.includes(secret), `leaked ${secret} in ${text}`)
}

test('device data is logged as counts, never the configs with their tokens', () => {
  const out = deviceDataSummary({ serverConnectionConfigs: [config, config], lastServerConnectionConfigId: config.id, deviceSettings: {} })
  assertNoCredentials(out)
  assert.deepEqual(JSON.parse(out), { serverConnectionConfigs: 2, hasLastServerConnectionConfig: true })
  assert.equal(deviceDataSummary(null), '(none)')
})

test('a server connection config is logged as flags, never its token, address or username', () => {
  const out = serverConnectionConfigSummary(config)
  assertNoCredentials(out)
  assert.deepEqual(JSON.parse(out), { index: 0, version: '2.36.1', hasToken: true })
  assert.equal(serverConnectionConfigSummary(undefined), '(none)')
})

test('db service logs summaries instead of serialized device data or configs', async () => {
  const db = await read('../plugins/db.js')
  assert.ok(db.includes('deviceDataSummary(data)'))
  assert.ok(db.includes('serverConnectionConfigSummary(data)'))
  assert.ok(!/console\.log\('(Loaded device data|Set server connection config)', JSON\.stringify/.test(db))
})

test('Capacitor bridge logging is off, so plugin call data, console and cookies never reach logcat', async () => {
  const config = JSON.parse(await read('../capacitor.config.json'))
  assert.equal(config.loggingBehavior, 'none')
})
