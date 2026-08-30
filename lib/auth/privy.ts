import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

const PRIVY_ISSUERS = ["privy.io", "https://auth.privy.io", "https://auth.privy.io/"]
const ACCEPTED_ALGORITHMS = ["ES256"] as const

/** How long a JWKS fetch is considered fresh before the cache is silently refreshed. */
const JWKS_SOFT_TTL_MS = 5 * 60 * 1_000
/** How long a stale JWKS is served when the remote is unreachable. */
const JWKS_STALE_TTL_MS = 10 * 60 * 1_000

type RawLinkedAccount = {
  type?: string
  address?: string
  email?: string
  phoneNumber?: string
  phone_number?: string
  number?: string
  name?: string
  display_name?: string
  first_name?: string
  last_name?: string
  username?: string
}

interface RawPrivyUser {
  id: string
  linked_accounts?: RawLinkedAccount[] | string
  custom_metadata?: Record<string, unknown> | null
}

export interface PrivyIdentityPayload extends JWTPayload {
  sub: string
  email?: string
  phone_number?: string
  linked_accounts?: RawLinkedAccount[] | string
}

export interface ParsedPrivyProfile {
  privyUserId: string
  email?: string
  phoneNumber?: string
  walletAddress?: string
  fullName?: string
}

interface JwksCacheEntry {
  jwks: ReturnType<typeof createRemoteJWKSet>
  fetchedAt: number
}
let jwksCacheEntry: JwksCacheEntry | null = null
let jwksInflight: Promise<JwksCacheEntry> | null = null

function normalizeString(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isProbablyRealName(value: string | undefined) {
  if (!value) return false
  if (value.includes("@")) return false
  if (value.startsWith("did:privy:")) return false
  return true
}

function getPrivyAppId() {
  const configuredId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID
  if (configuredId) return configuredId

  const jwksUrl = process.env.PRIVY_JWKS_URL
  if (!jwksUrl) return null

  const match = jwksUrl.match(/\/apps\/([^/]+)\/jwks\.json$/)
  return match?.[1] ?? null
}

function getPrivyAppSecret() {
  const secret = process.env.PRIVY_APP_SECRET?.trim()
  return secret || null
}

function getPrivyJwksUrl() {
  if (process.env.PRIVY_JWKS_URL) return process.env.PRIVY_JWKS_URL
  const appId = getPrivyAppId()
  if (!appId) {
    throw new Error("Missing PRIVY_JWKS_URL and Privy App ID (PRIVY_APP_ID or NEXT_PUBLIC_PRIVY_APP_ID)")
  }

  return `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`
}

function getPrivyAudience() {
  const appId = getPrivyAppId()
  if (!appId) throw new Error("Privy App ID is required (PRIVY_APP_ID or NEXT_PUBLIC_PRIVY_APP_ID)")
  return appId
}

async function getPrivyJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  const now = Date.now()

  if (jwksCacheEntry && now - jwksCacheEntry.fetchedAt < JWKS_SOFT_TTL_MS) {
    return jwksCacheEntry.jwks
  }

  if (!jwksInflight) {
    jwksInflight = Promise.resolve()
      .then(() => {
        const jwks = createRemoteJWKSet(new URL(getPrivyJwksUrl()))
        return { jwks, fetchedAt: Date.now() }
      })
      .then((entry) => {
        jwksCacheEntry = entry
        jwksInflight = null
        return entry
      })
      .catch((err) => {
        jwksInflight = null
        if (jwksCacheEntry && now - jwksCacheEntry.fetchedAt < JWKS_STALE_TTL_MS) {
          return jwksCacheEntry
        }
        throw err
      })
  }

  const entry = await jwksInflight
  return entry.jwks
}

function readBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null
  const [scheme, token] = headerValue.split(" ")
  if (scheme?.toLowerCase() !== "bearer" || !token) return null
  return token
}

function parseLinkedAccounts(linkedAccounts: PrivyIdentityPayload["linked_accounts"] | RawPrivyUser["linked_accounts"]) {
  if (!linkedAccounts) return [] as RawLinkedAccount[]
  if (Array.isArray(linkedAccounts)) return linkedAccounts

  if (typeof linkedAccounts === "string") {
    try {
      const parsed = JSON.parse(linkedAccounts)
      return Array.isArray(parsed) ? (parsed as RawLinkedAccount[]) : []
    } catch {
      return []
    }
  }

  return []
}

function resolvePrivyEmail(linkedAccounts: RawLinkedAccount[], payloadEmail?: string) {
  const directEmail = normalizeString(payloadEmail)?.toLowerCase()
  if (directEmail) return directEmail

  for (const account of linkedAccounts) {
    if (account.type === "email") {
      const emailAddress = normalizeString(account.address || account.email)?.toLowerCase()
      if (emailAddress) return emailAddress
    }

    const oauthEmail = normalizeString(account.email)?.toLowerCase()
    if (oauthEmail) return oauthEmail
  }

  return undefined
}

function resolvePrivyPhone(linkedAccounts: RawLinkedAccount[], payloadPhoneNumber?: string) {
  const directPhone = normalizeString(payloadPhoneNumber)
  if (directPhone) return directPhone

  for (const account of linkedAccounts) {
    const phoneNumber = normalizeString(account.phoneNumber || account.phone_number || account.number)
    if (phoneNumber) return phoneNumber
  }

  return undefined
}

function resolvePrivyWalletAddress(linkedAccounts: RawLinkedAccount[]) {
  const walletAccount = linkedAccounts.find((account) => account.type === "wallet" && typeof account.address === "string")
  return normalizeString(walletAccount?.address)?.toLowerCase()
}

function resolvePrivyFullName(
  linkedAccounts: RawLinkedAccount[],
  customMetadata?: Record<string, unknown> | null,
) {
  const metadataNameCandidates = [
    normalizeString(customMetadata?.["fullName"]),
    normalizeString(customMetadata?.["full_name"]),
    normalizeString(customMetadata?.["name"]),
  ]
  const metadataName = metadataNameCandidates.find(isProbablyRealName)
  if (metadataName) return metadataName

  for (const account of linkedAccounts) {
    const composedName = [normalizeString(account.first_name), normalizeString(account.last_name)].filter(Boolean).join(" ")
    if (isProbablyRealName(composedName)) return composedName

    const namedCandidate = [normalizeString(account.name), normalizeString(account.display_name)].find(isProbablyRealName)
    if (namedCandidate) return namedCandidate
  }

  return undefined
}

function parsePrivyProfile(input: {
  privyUserId: string
  linkedAccounts?: RawLinkedAccount[] | string
  payloadEmail?: string
  payloadPhoneNumber?: string
  customMetadata?: Record<string, unknown> | null
}): ParsedPrivyProfile {
  const linkedAccounts = parseLinkedAccounts(input.linkedAccounts)

  return {
    privyUserId: input.privyUserId,
    email: resolvePrivyEmail(linkedAccounts, input.payloadEmail),
    phoneNumber: resolvePrivyPhone(linkedAccounts, input.payloadPhoneNumber),
    walletAddress: resolvePrivyWalletAddress(linkedAccounts),
    fullName: resolvePrivyFullName(linkedAccounts, input.customMetadata),
  }
}

async function parseJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { message: text }
  }
}

export function extractPrivyTokenFromRequest(request: Request) {
  return (
    request.headers.get("privy-id-token") ||
    request.headers.get("x-privy-token") ||
    readBearerToken(request.headers.get("authorization"))
  )
}

export async function verifyPrivyToken(token: string) {
  const jwks = await getPrivyJwks()
  const { payload } = await jwtVerify(token, jwks, {
    issuer: PRIVY_ISSUERS,
    audience: getPrivyAudience(),
    algorithms: [...ACCEPTED_ALGORITHMS],
    clockTolerance: 60,
  })

  if (!payload.sub || payload.sub.trim().length === 0) {
    throw new Error("Token subject (sub) is missing or empty.")
  }

  return payload as PrivyIdentityPayload
}

export function getPrivyProfileFromPayload(payload: PrivyIdentityPayload): ParsedPrivyProfile {
  return parsePrivyProfile({
    privyUserId: payload.sub,
    linkedAccounts: payload.linked_accounts,
    payloadEmail: payload.email,
    payloadPhoneNumber: payload.phone_number,
  })
}

export async function fetchPrivyProfileByUserId(privyUserId: string) {
  const normalizedPrivyUserId = normalizeString(privyUserId)
  if (!normalizedPrivyUserId) return null

  const appId = getPrivyAppId()
  const appSecret = getPrivyAppSecret()
  if (!appId || !appSecret) return null

  const response = await fetch(`https://api.privy.io/v1/users/${encodeURIComponent(normalizedPrivyUserId)}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
      "privy-app-id": appId,
    },
    cache: "no-store",
  })

  if (response.status === 404) return null

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    const message =
      payload && typeof payload.message === "string"
        ? payload.message
        : `Failed to fetch Privy user ${normalizedPrivyUserId}.`
    throw new Error(message)
  }

  const user = payload as unknown as RawPrivyUser
  return parsePrivyProfile({
    privyUserId: user.id || normalizedPrivyUserId,
    linkedAccounts: user.linked_accounts,
    customMetadata: user.custom_metadata || null,
  })
}
