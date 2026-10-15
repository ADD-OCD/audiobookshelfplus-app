import { registerPlugin, WebPlugin } from '@capacitor/core'

// RICE "Import theme colors" (android/.../plugins/AbsThemeImport.kt). The network boundary (one API host, DNS checks,
// manual redirects, budgets) is enforced natively; a browser fetch could not enforce it, so the browser fallback
// (development only) refuses instead of importing with weaker rules.
class AbsThemeImportWeb extends WebPlugin {
  async start() {
    throw Object.assign(new Error('unsupported-platform'), { code: 'unsupported-platform' })
  }

  async readCandidate() {
    throw Object.assign(new Error('unsupported-platform'), { code: 'unsupported-platform' })
  }

  async cancel() {}
}

const AbsThemeImport = registerPlugin('AbsThemeImport', { web: () => new AbsThemeImportWeb() })

export { AbsThemeImport }
