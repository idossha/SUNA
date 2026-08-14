import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LitProviderId } from '@suna/core'

/**
 * Provider API keys, encrypted at rest with Electron safeStorage (OS keychain
 * backed). Persisted as base64 ciphertext under userData/keys.json.
 * Keys are never logged and never included in error messages.
 *
 * Two namespaces share the file: agent providers keyed by their bare id, and
 * literature providers keyed as `lit:<provider>`.
 */

export type AgentProviderId = 'anthropic' | 'openai' | 'ollama'

/** Slot name for a literature provider key; never collides with agent slots. */
function litSlot(provider: LitProviderId): string {
  return `lit:${provider}`
}

function keysFilePath(): string {
  return join(app.getPath('userData'), 'keys.json')
}

async function loadStore(): Promise<Record<string, string>> {
  let raw: string
  try {
    raw = await readFile(keysFilePath(), 'utf8')
  } catch {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const store: Record<string, string> = {}
    for (const [provider, value] of Object.entries(parsed)) {
      if (typeof value === 'string') store[provider] = value
    }
    return store
  } catch {
    return {}
  }
}

async function saveStore(store: Record<string, string>): Promise<void> {
  const file = keysFilePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
}

async function setSlot(slot: string, key: string): Promise<void> {
  const store = await loadStore()
  if (key === '') {
    delete store[slot]
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('secure key storage is not available on this system')
    }
    store[slot] = safeStorage.encryptString(key).toString('base64')
  }
  await saveStore(store)
}

async function hasSlot(slot: string): Promise<boolean> {
  const store = await loadStore()
  const value = store[slot]
  return typeof value === 'string' && value.length > 0
}

async function getSlot(slot: string): Promise<string | null> {
  const store = await loadStore()
  const encrypted = store[slot]
  if (encrypted === undefined || encrypted === '') return null
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

/** Store a provider key (encrypted). An empty key clears the stored entry. */
export async function setKey(provider: AgentProviderId, key: string): Promise<void> {
  await setSlot(provider, key)
}

/** Presence check without decrypting anything. */
export async function hasKey(provider: AgentProviderId): Promise<boolean> {
  return hasSlot(provider)
}

/** Decrypt and return the stored key, or null when none is stored. */
export async function getKey(provider: AgentProviderId): Promise<string | null> {
  return getSlot(provider)
}

/** Literature-provider keys (OpenAlex, NASA ADS). Empty key clears the entry. */
export async function setLitKey(provider: LitProviderId, key: string): Promise<void> {
  await setSlot(litSlot(provider), key)
}

export async function hasLitKey(provider: LitProviderId): Promise<boolean> {
  return hasSlot(litSlot(provider))
}

export async function getLitKey(provider: LitProviderId): Promise<string | null> {
  return getSlot(litSlot(provider))
}
