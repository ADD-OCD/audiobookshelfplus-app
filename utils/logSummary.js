// Console-safe summaries of objects that hold credentials. Device data and server connection configs
// carry access tokens and usernames, so they are summarised (counts and flags) instead of logged whole.

export function deviceDataSummary(data) {
  if (!data) return '(none)'
  const configs = Array.isArray(data.serverConnectionConfigs) ? data.serverConnectionConfigs : []
  return JSON.stringify({ serverConnectionConfigs: configs.length, hasLastServerConnectionConfig: !!data.lastServerConnectionConfigId })
}

export function serverConnectionConfigSummary(config) {
  if (!config) return '(none)'
  return JSON.stringify({ index: config.index ?? null, version: config.version ?? null, hasToken: !!config.token })
}
