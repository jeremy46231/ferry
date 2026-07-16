import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env, resolveConfig, validateConfig } from './config'

const ENV_KEYS = [
  'FERRY_BASE_URL',
  'FERRY_BASE_PATH',
  'FERRY_HCA_CLIENT_ID',
  'FERRY_HCA_CLIENT_SECRET',
  'FERRY_HCA_SCOPES',
  'FERRY_HACKATIME_MODE',
  'FERRY_HACKATIME_CLIENT_ID',
  'FERRY_HACKATIME_CLIENT_SECRET',
  'FERRY_HACKATIME_SCOPES',
  'FERRY_AIRTABLE_API_KEY',
  'FERRY_AIRTABLE_BASE_ID',
  'FERRY_FILLOUT_FORM_URL',
  'FERRY_SESSION_SECRET',
]

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const SECRET = 'x'.repeat(32)

/** A fully-valid override set for tests that need to pass validation. */
function validOverrides() {
  return {
    hackClubAuth: { clientId: 'hca', clientSecret: 'hca-secret' },
    hackatime: {
      mode: 'required' as const,
      clientId: 'ht',
      clientSecret: 'ht-secret',
    },
    airtable: { apiKey: 'key', baseId: 'appABC' },
    fillout: { formUrl: 'https://forms.example.com/x' },
    session: { secret: SECRET },
  }
}

describe('env()', () => {
  it('never throws and returns undefined for missing keys', () => {
    expect(env('FERRY_DOES_NOT_EXIST')).toBeUndefined()
  })

  it('reads a present variable', () => {
    process.env.FERRY_BASE_URL = 'https://example.com'
    expect(env('FERRY_BASE_URL')).toBe('https://example.com')
  })

  it('treats empty strings as absent', () => {
    process.env.FERRY_BASE_URL = ''
    expect(env('FERRY_BASE_URL')).toBeUndefined()
  })
})

describe('resolveConfig()', () => {
  it('applies defaults and never throws on an empty env', () => {
    const cfg = resolveConfig()
    expect(cfg.basePath).toBe('/submit')
    expect(cfg.hackatime.mode).toBe('required')
    expect(cfg.hackatime.scopes).toEqual(['profile', 'read'])
    expect(cfg.fillout.linkingKeyParam).toBe('auth_token')
    expect(cfg.session.cookieName).toBe('ferry_session')
    expect(cfg.session.ttlSeconds).toBe(3600)
    expect(cfg.session.secure).toBe(true)
    expect(cfg.hackClubAuth.scopes).toContain('slack_id')
    expect(cfg.airtable.tables.users).toBe('User')
  })

  it('reads values from the environment', () => {
    process.env.FERRY_HCA_CLIENT_ID = 'from-env'
    process.env.FERRY_HACKATIME_MODE = 'off'
    process.env.FERRY_BASE_PATH = 'apply/'
    const cfg = resolveConfig()
    expect(cfg.hackClubAuth.clientId).toBe('from-env')
    expect(cfg.hackatime.mode).toBe('off')
    expect(cfg.basePath).toBe('/apply')
  })

  it('lets explicit overrides win over env', () => {
    process.env.FERRY_HCA_CLIENT_ID = 'from-env'
    const cfg = resolveConfig({ hackClubAuth: { clientId: 'override' } })
    expect(cfg.hackClubAuth.clientId).toBe('override')
  })

  it('parses scope strings from env', () => {
    process.env.FERRY_HCA_SCOPES = 'openid  email, name'
    const cfg = resolveConfig()
    expect(cfg.hackClubAuth.scopes).toEqual(['openid', 'email', 'name'])
  })

  it('normalizes the base path (leading slash, no trailing slash)', () => {
    expect(resolveConfig({ basePath: 'submit' }).basePath).toBe('/submit')
    expect(resolveConfig({ basePath: '/submit/' }).basePath).toBe('/submit')
    expect(resolveConfig({ basePath: '/' }).basePath).toBe('/')
  })
})

describe('validateConfig()', () => {
  it('reports all missing required fields on an empty config', () => {
    const problems = validateConfig(resolveConfig())
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain('hackClubAuth.clientId')
    expect(problems.join('\n')).toContain('session.secret')
  })

  it('passes with a complete config', () => {
    expect(validateConfig(resolveConfig(validOverrides()))).toEqual([])
  })

  it('does not require hackatime creds when mode is off', () => {
    const cfg = resolveConfig({
      ...validOverrides(),
      hackatime: { mode: 'off' },
    })
    expect(validateConfig(cfg)).toEqual([])
  })

  it('rejects a too-short session secret', () => {
    const cfg = resolveConfig({
      ...validOverrides(),
      session: { secret: 'short' },
    })
    expect(validateConfig(cfg).join('\n')).toContain('at least 32 characters')
  })
})
