import { afterEach, describe, expect, test, vi } from 'bun:test'

import { fetchStub } from '@open-pencil/test-support/fetch'

import { AUTOMATION_HTTP_URL } from '@/app/automation/mcp/health'
import {
  AGENT_EDITOR_TOKEN_PATH,
  readAgentEditorHandle,
  spawnMCPIfNeeded
} from '@/app/automation/mcp/spawn'
import { APP_VERSION } from '@/app/runtime/version'

const TOKEN = 'ab'.repeat(32)

afterEach(() => {
  vi.restoreAllMocks()
})

function stubServers(tokenResponse: () => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    fetchStub(async (input, init) => {
      const url = String(input)
      if (url === AGENT_EDITOR_TOKEN_PATH) return tokenResponse()
      if (url === `${AUTOMATION_HTTP_URL}/health`) {
        const authorized = new Headers(init?.headers).get('Authorization') === `Bearer ${TOKEN}`
        // A server of this version says it takes client tokens; the app refuses one that doesn't.
        const health = { status: 'ok', version: APP_VERSION, clientTokens: true }
        return authorized
          ? new Response(JSON.stringify(health), { status: 200 })
          : new Response('', { status: 401 })
      }
      throw new Error(`unexpected request: ${url}`)
    })
  )
}

describe("the agents' editor", () => {
  test('reads its token from its own origin and connects with it', async () => {
    const fetchMock = stubServers(() => new Response(`${TOKEN}\n`, { status: 200 }))

    await expect(readAgentEditorHandle()).resolves.toEqual({
      disconnect: expect.any(Function),
      authToken: TOKEN,
      managed: false
    })
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      AGENT_EDITOR_TOKEN_PATH,
      `${AUTOMATION_HTTP_URL}/health`
    ])
  })

  test('takes no agent server when its origin serves a page instead of a token', async () => {
    const fetchMock = stubServers(() => new Response('<!doctype html>', { status: 200 }))

    await expect(readAgentEditorHandle()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('a browser editor built without the setting asks for no token', async () => {
    const fetchMock = stubServers(() => new Response(TOKEN, { status: 200 }))

    await expect(spawnMCPIfNeeded()).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
