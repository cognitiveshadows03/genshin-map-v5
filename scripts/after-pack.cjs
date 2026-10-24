'use strict'

const { rmSync } = require('node:fs')
const { join } = require('node:path')

/** The portable app has no updater; do not ship generated update metadata. */
module.exports = async (context) => {
  rmSync(join(context.appOutDir, 'resources', 'app-update.yml'), { force: true })
}
