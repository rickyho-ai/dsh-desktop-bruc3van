/** Safe, narrow migration of the connection choice from the pre-rename home. */

export interface SettingsDocument {
  serverUrl?: unknown
  connectionMode?: unknown
  [key: string]: unknown
}

function isDocument(value: unknown): value is SettingsDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeServerUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  let candidate = value.trim()
  if (!/^https?:\/\//i.test(candidate)) candidate = 'http://' + candidate
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

function hasValidConnectionSettings(settings: SettingsDocument): boolean {
  if (settings.connectionMode === 'smart') return true
  return normalizeServerUrl(settings.serverUrl) !== undefined
    && (settings.connectionMode === undefined || settings.connectionMode === 'connect')
}

/**
 * Return a current settings document with only a legacy Connect selection
 * migrated, or undefined when no safe migration is needed or possible.
 */
export function migrateLegacyConnectionSettings(
  currentValue: unknown,
  legacyValue: unknown,
): SettingsDocument | undefined {
  if (!isDocument(currentValue) || !isDocument(legacyValue)) return undefined
  if (hasValidConnectionSettings(currentValue)) return undefined

  const serverUrl = normalizeServerUrl(legacyValue.serverUrl)
  if (serverUrl === undefined
    || (legacyValue.connectionMode !== undefined && legacyValue.connectionMode !== 'connect')) return undefined
  return { ...currentValue, serverUrl, connectionMode: 'connect' }
}
