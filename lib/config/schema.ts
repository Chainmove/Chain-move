import { createHash } from "crypto"
import { z } from "zod"

export const PLACEHOLDER_PATTERN = /^(replace_|changeme|change_me|placeholder|example|test-secret|secret|password)/i

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return value
  return ["1", "true", "yes", "on"].includes(value.toLowerCase())
}, z.boolean())

const optionalUrl = z
  .string()
  .trim()
  .url()
  .optional()
  .or(z.literal("").transform(() => undefined))

const requiredUrl = z.string().trim().url()

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXT_PUBLIC_APP_URL: requiredUrl.default("http://localhost:3000"),
    NEXT_PUBLIC_PRIVY_APP_ID: z.string().trim().optional(),
    MONGODB_URI: z.string().trim().min(1, "MONGODB_URI is required."),
    JWT_SECRET: z.string().trim().optional(),
    AUTH_SESSION_SECRET: z.string().trim().optional(),
    KYC_DOCUMENT_ENCRYPTION_KEY: z.string().trim().optional(),
    KYC_ACTIVE_KEY_VERSION: z.string().trim().optional(),
    KYC_PREVIOUS_KEY_VERSIONS: z.string().trim().optional(),
    KYC_ENCRYPTION_KEYS_JSON: z.string().trim().optional(),
    KYC_DOCUMENT_SIGNING_KEY: z.string().trim().optional(),
    KYC_DOCUMENT_SIGNING_KEY_ID: z.string().trim().optional(),
    KYC_DOCUMENT_SIGNING_KEYS_JSON: z.string().trim().optional(),
    PRIVY_APP_ID: z.string().trim().optional(),
    PRIVY_APP_SECRET: z.string().trim().optional(),
    PRIVY_JWKS_URL: optionalUrl,
    PAYSTACK_PUBLIC_KEY: z.string().trim().optional(),
    PAYSTACK_SECRET_KEY: z.string().trim().optional(),
    PAYSTACK_DVA_PREFERRED_BANK: z.string().trim().optional(),
    RESEND_API_KEY: z.string().trim().optional(),
    BLOB_READ_WRITE_TOKEN: z.string().trim().optional(),
    ENABLE_MOCK_PAYMENTS: booleanFromEnv.default(false),
    ENABLE_MOCK_EMAILS: booleanFromEnv.default(false),
    ENABLE_MOCK_STELLAR: booleanFromEnv.default(false),
    STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
    STELLAR_HORIZON_URL: optionalUrl,
    STELLAR_RPC_URL: optionalUrl,
    STELLAR_ASSET_CODE: z.string().trim().optional(),
    STELLAR_ISSUER_PUBLIC_KEY: z.string().trim().optional(),
    STELLAR_DISTRIBUTION_PUBLIC_KEY: z.string().trim().optional(),
    STELLAR_CONTRACT_ID: z.string().trim().optional(),
    FX_PROVIDER: z.enum(["static", "mock"]).default("static"),
    FX_STATIC_RATES_JSON: z.string().trim().optional(),
    FX_MAX_QUOTE_AGE_SECONDS: z.coerce.number().int().positive().default(900),
    FX_QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    FX_DEVIATION_BPS: z.coerce.number().int().min(0).max(10_000).default(250),
    FX_MARKUP_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .superRefine((value, context) => {
    const isProduction = value.NODE_ENV === "production"
    const critical = [
      "MONGODB_URI",
      "JWT_SECRET",
      "AUTH_SESSION_SECRET",
      "PRIVY_APP_SECRET",
      "PAYSTACK_SECRET_KEY",
      "RESEND_API_KEY",
      "BLOB_READ_WRITE_TOKEN",
    ] as const

    if (isProduction) {
      for (const key of critical) {
        const secret = value[key]
        if (!secret || secret.length < 24 || PLACEHOLDER_PATTERN.test(secret)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must be a strong non-placeholder production value.`,
          })
        }
      }

      if (!value.KYC_DOCUMENT_SIGNING_KEY && !value.KYC_DOCUMENT_SIGNING_KEYS_JSON) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["KYC_DOCUMENT_SIGNING_KEY"],
          message: "A dedicated KYC document signing key is required in production.",
        })
      } else if (value.KYC_DOCUMENT_SIGNING_KEY && (
        value.KYC_DOCUMENT_SIGNING_KEY.length < 32 || PLACEHOLDER_PATTERN.test(value.KYC_DOCUMENT_SIGNING_KEY)
      )) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["KYC_DOCUMENT_SIGNING_KEY"],
          message: "KYC_DOCUMENT_SIGNING_KEY must be a strong non-placeholder production value.",
        })
      }

      if (value.KYC_DOCUMENT_SIGNING_KEYS_JSON) {
        try {
          const signingKeys = JSON.parse(value.KYC_DOCUMENT_SIGNING_KEYS_JSON) as {
            active?: { id?: string; secret?: string }
            previous?: Array<{ id?: string; secret?: string }>
          }
          const keys = [signingKeys.active, ...(signingKeys.previous || [])]
          if (keys.some((key) => !key?.id || !key.secret || key.secret.length < 32 || PLACEHOLDER_PATTERN.test(key.secret))) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["KYC_DOCUMENT_SIGNING_KEYS_JSON"],
              message: "Every document signing key must have an ID and a strong non-placeholder secret.",
            })
          }
        } catch {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["KYC_DOCUMENT_SIGNING_KEYS_JSON"],
            message: "KYC_DOCUMENT_SIGNING_KEYS_JSON must be valid JSON.",
          })
        }
      }

      if (value.ENABLE_MOCK_PAYMENTS || value.ENABLE_MOCK_EMAILS || value.ENABLE_MOCK_STELLAR) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NODE_ENV"],
          message: "Production cannot enable mock payment, email, or Stellar modes.",
        })
      }
    }
  })

export type AppConfig = z.infer<typeof envSchema>

export type VersionedSecret = {
  version: string
  secret: string
  status: "active" | "previous"
  fingerprint: string
}

export type Keyring = {
  active: VersionedSecret
  previous: VersionedSecret[]
}

function fingerprint(secret: string) {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12)
}

function sanitizeIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "root",
    message: issue.message.replace(/(["']?).+?\1/g, "[redacted]"),
  }))
}

export function parseAppConfig(raw: Record<string, unknown> = process.env) {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const summary = sanitizeIssues(result.error)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ")
    throw new Error(`Invalid ChainMove configuration: ${summary}`)
  }

  return result.data
}

export function buildKeyring(config: Pick<AppConfig, "KYC_DOCUMENT_ENCRYPTION_KEY" | "KYC_ACTIVE_KEY_VERSION" | "KYC_PREVIOUS_KEY_VERSIONS" | "KYC_ENCRYPTION_KEYS_JSON" | "JWT_SECRET" | "AUTH_SESSION_SECRET" | "PRIVY_APP_SECRET">): Keyring {
  if (config.KYC_ENCRYPTION_KEYS_JSON) {
    const parsed = z
      .object({
        active: z.object({ version: z.string().min(1), secret: z.string().min(16) }),
        previous: z.array(z.object({ version: z.string().min(1), secret: z.string().min(16) })).default([]),
      })
      .parse(JSON.parse(config.KYC_ENCRYPTION_KEYS_JSON))

    return {
      active: {
        version: parsed.active.version,
        secret: parsed.active.secret,
        status: "active",
        fingerprint: fingerprint(parsed.active.secret),
      },
      previous: parsed.previous.map((key) => ({
        version: key.version,
        secret: key.secret,
        status: "previous",
        fingerprint: fingerprint(key.secret),
      })),
    }
  }

  const sourceSecret =
    config.KYC_DOCUMENT_ENCRYPTION_KEY ||
    config.JWT_SECRET ||
    config.AUTH_SESSION_SECRET ||
    config.PRIVY_APP_SECRET

  if (!sourceSecret) {
    throw new Error("KYC document encryption secret is not configured.")
  }

  const activeVersion = config.KYC_ACTIVE_KEY_VERSION || "kyc-v1"
  const previousVersions = (config.KYC_PREVIOUS_KEY_VERSIONS || "")
    .split(",")
    .map((version) => version.trim())
    .filter(Boolean)

  return {
    active: {
      version: activeVersion,
      secret: sourceSecret,
      status: "active",
      fingerprint: fingerprint(sourceSecret),
    },
    previous: previousVersions.map((version) => ({
      version,
      secret: sourceSecret,
      status: "previous",
      fingerprint: fingerprint(sourceSecret),
    })),
  }
}

export function getRedactedConfigDiagnostics(config: AppConfig, keyring = buildKeyring(config)) {
  return {
    nodeEnv: config.NODE_ENV,
    appUrl: config.NEXT_PUBLIC_APP_URL,
    mocks: {
      payments: config.ENABLE_MOCK_PAYMENTS,
      emails: config.ENABLE_MOCK_EMAILS,
      stellar: config.ENABLE_MOCK_STELLAR,
    },
    providers: {
      paystack: Boolean(config.PAYSTACK_SECRET_KEY),
      resend: Boolean(config.RESEND_API_KEY),
      privy: Boolean(config.PRIVY_APP_SECRET),
      stellar: config.STELLAR_NETWORK,
      fx: config.FX_PROVIDER,
    },
    keyVersions: {
      kycActive: keyring.active.version,
      kycPrevious: keyring.previous.map((key) => key.version),
      activeFingerprint: keyring.active.fingerprint,
    },
  }
}
