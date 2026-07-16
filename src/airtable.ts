import type { ResolvedConfig } from './config'
import type { HcaIdentity } from './providers/hackclub'
import { randomToken } from './random'

/**
 * Thin Airtable REST client (no SDK — just `fetch`, so it stays edge-safe).
 * Only the operations Ferry needs: find/create/update the `User` row.
 */

const API_ROOT = 'https://api.airtable.com/v0'

export interface AirtableConfig {
  apiKey: string
  baseId: string
  tables: ResolvedConfig['airtable']['tables']
}

/** Field names on the `User` table (as they appear in Airtable). */
const USER_FIELDS = {
  slackId: 'Slack ID',
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  birthday: 'Birthday',
  addressLine1: 'Address (Line 1)',
  addressLine2: 'Address (Line 2)',
  city: 'City',
  stateProvince: 'State / Province',
  country: 'Country',
  zip: 'ZIP / Postal Code',
  authToken: 'Auth Token',
} as const

export interface AirtableRecord<F = Record<string, unknown>> {
  id: string
  fields: F
  createdTime?: string
}

interface ListResponse<F> {
  records: AirtableRecord<F>[]
  offset?: string
}

/** Require Airtable credentials from config (guaranteed by validateConfig, but
 * narrowed here without a non-null assertion). */
export function requireAirtable(config: ResolvedConfig): AirtableConfig {
  const { apiKey, baseId, tables } = config.airtable
  if (!apiKey || !baseId) {
    throw new Error('Airtable credentials are not configured')
  }
  return { apiKey, baseId, tables }
}

async function airtableFetch<T>(
  cfg: AirtableConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_ROOT}/${cfg.baseId}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `airtable ${init.method ?? 'GET'} ${path} failed (${res.status}): ${text}`
    )
  }
  return (await res.json()) as T
}

/** Escape a value for safe interpolation into an Airtable formula string. */
function formulaString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** Look up a User row by Slack ID; returns null if none exists. */
export async function findUserBySlackId(
  cfg: AirtableConfig,
  slackId: string
): Promise<AirtableRecord | null> {
  const table = encodeURIComponent(cfg.tables.users)
  const formula = `{${USER_FIELDS.slackId}} = ${formulaString(slackId)}`
  // Encode with %20 (not URLSearchParams, which uses `+`) so Airtable parses
  // the formula's spaces correctly.
  const path = `${table}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const data = await airtableFetch<ListResponse<Record<string, unknown>>>(
    cfg,
    path
  )
  return data.records[0] ?? null
}

/** Map an HCA identity onto writable `User` fields. */
function identityToUserFields(identity: HcaIdentity): Record<string, unknown> {
  const address =
    identity.addresses?.find((a) => a.primary) ?? identity.addresses?.[0]

  const fields: Record<string, unknown> = {
    [USER_FIELDS.slackId]: identity.slack_id,
    [USER_FIELDS.firstName]: identity.first_name,
    [USER_FIELDS.lastName]: identity.last_name,
    [USER_FIELDS.email]: identity.primary_email,
    [USER_FIELDS.birthday]: identity.birthday,
    [USER_FIELDS.addressLine1]: address?.line_1,
    [USER_FIELDS.addressLine2]: address?.line_2,
    [USER_FIELDS.city]: address?.city,
    [USER_FIELDS.stateProvince]: address?.state,
    [USER_FIELDS.country]: address?.country,
    [USER_FIELDS.zip]: address?.postal_code,
  }

  // Drop undefined so we never clobber existing values with blanks.
  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) delete fields[key]
  }
  return fields
}

export interface UpsertResult {
  record: AirtableRecord
  authToken: string
  created: boolean
}

/**
 * Create or update the User row for an identity, keyed on Slack ID.
 *
 * Ferry mints the `Auth Token` itself and writes it on creation (no reliance on
 * an Airtable automation, and no create-then-reread round trip). Returning users
 * keep their existing token.
 */
export async function upsertUser(
  cfg: AirtableConfig,
  identity: HcaIdentity
): Promise<UpsertResult> {
  if (!identity.slack_id) {
    throw new Error('cannot upsert a User without a Slack ID')
  }
  const table = encodeURIComponent(cfg.tables.users)
  const existing = await findUserBySlackId(cfg, identity.slack_id)
  const fields = identityToUserFields(identity)

  if (existing) {
    const existingToken = existing.fields[USER_FIELDS.authToken]
    const authToken =
      typeof existingToken === 'string' && existingToken.length > 0
        ? existingToken
        : randomToken()
    // Preserve/backfill the token; refresh identity fields.
    const record = await airtableFetch<AirtableRecord>(
      cfg,
      `${table}/${existing.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          fields: { ...fields, [USER_FIELDS.authToken]: authToken },
          typecast: true,
        }),
      }
    )
    return { record, authToken, created: false }
  }

  const authToken = randomToken()
  const record = await airtableFetch<AirtableRecord>(cfg, table, {
    method: 'POST',
    body: JSON.stringify({
      fields: { ...fields, [USER_FIELDS.authToken]: authToken },
      typecast: true,
    }),
  })
  return { record, authToken, created: true }
}
