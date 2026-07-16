import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHackatimeUser, fetchProjects } from './hackatime'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchProjects()', () => {
  const payload = {
    projects: [
      { name: 'active', total_seconds: 100, archived: false },
      { name: 'also-active', total_seconds: 50 },
      { name: 'archived', total_seconds: 200, archived: true },
    ],
  }

  it('excludes archived projects by default and sends a Bearer token', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain('/api/v1/authenticated/projects')
        expect(String(input)).not.toContain('include_archived')
        const headers = init?.headers as Record<string, string> | undefined
        expect(headers?.authorization).toBe('Bearer ht-tok')
        return json(payload)
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    const projects = await fetchProjects('ht-tok')
    expect(projects.map((p) => p.name)).toEqual(['active', 'also-active'])
  })

  it('includes archived projects when asked', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('include_archived=true')
      return json(payload)
    })
    vi.stubGlobal('fetch', fetchMock)

    const projects = await fetchProjects('ht-tok', true)
    expect(projects).toHaveLength(3)
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'nope' }, 401))
    )
    await expect(fetchProjects('bad')).rejects.toThrow(/401/)
  })
})

describe('fetchHackatimeUser()', () => {
  it('returns the numeric id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ id: 42, slack_id: 'U123' }))
    )
    const user = await fetchHackatimeUser('ht-tok')
    expect(user.id).toBe(42)
  })
})
