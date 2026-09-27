/** Deterministic regression check for the startup settings-home migration. */

import { migrateLegacyConnectionSettings } from '../src/main/settings-home-migration.ts'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

const legacyConnect = {
  serverUrl: 'http://127.0.0.1:3081',
  connectionMode: 'connect',
  apiKey: 'must-not-copy',
}
const migrated = migrateLegacyConnectionSettings({ updateLastCheckedAt: 123 }, legacyConnect)
check(migrated?.serverUrl === 'http://127.0.0.1:3081' && migrated.connectionMode === 'connect',
  'legacy Connect settings did not migrate')
check(migrated.updateLastCheckedAt === 123 && !('apiKey' in migrated),
  'migration did not preserve current settings or copied a legacy credential')

const current = { serverUrl: 'http://127.0.0.1:3082', connectionMode: 'connect', updateLastCheckedAt: 456 }
check(migrateLegacyConnectionSettings(current, legacyConnect) === undefined,
  'valid current connection settings were overwritten')
check(migrateLegacyConnectionSettings({ connectionMode: 'smart' }, legacyConnect) === undefined,
  'an explicit Smart connection choice was overwritten')

check(migrateLegacyConnectionSettings({ updateLastCheckedAt: 789 }, undefined) === undefined,
  'missing legacy settings did not fail safe')
check(migrateLegacyConnectionSettings({ updateLastCheckedAt: 987 }, '{not json') === undefined,
  'malformed legacy settings did not fail safe')

console.log('✓ legacy Connect settings migrate without copying credentials')
console.log('✓ valid current connection settings are never overwritten')
console.log('✓ missing and malformed legacy settings fail safe')
console.log('✓ unrelated current settings survive migration')
