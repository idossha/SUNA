/** Shared fetch helper for provider adapters. Never includes API keys in errors. */

const MAX_RAW_ERROR_LENGTH = 200

export async function postJson(args: {
  provider: string
  url: string
  headers: Record<string, string>
  body: unknown
}): Promise<unknown> {
  const { provider, url, headers, body } = args
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${provider}: request to ${url} failed: ${detail}`)
  }
  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`${provider} request failed (HTTP ${res.status})${formatApiError(raw)}`)
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error(`${provider}: response was not valid JSON`)
  }
}

/**
 * Extract a human-readable message from an API error body.
 * Handles `{error: {message}}` (Anthropic, OpenAI) and `{error: "..."}` (Ollama).
 */
function formatApiError(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const err = (parsed as { error?: unknown }).error
      if (typeof err === 'string' && err !== '') return `: ${err}`
      if (typeof err === 'object' && err !== null) {
        const message = (err as { message?: unknown }).message
        if (typeof message === 'string' && message !== '') return `: ${message}`
      }
    }
  } catch {
    // not JSON; fall through to raw text
  }
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  return `: ${trimmed.slice(0, MAX_RAW_ERROR_LENGTH)}`
}
