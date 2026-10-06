import { registerPlugin, WebPlugin } from '@capacitor/core';

class AbsFileSystemWeb extends WebPlugin {
  constructor() {
    super()
  }

  async selectFolder() { }

  async rescanFolder() { }

  async isRescanning() {
    return { value: false }
  }
}

const AbsFileSystem = registerPlugin('AbsFileSystem', {
  web: () => new AbsFileSystemWeb()
})

export { AbsFileSystem }