import { readFileSync } from "fs"

const envExample = readFileSync(".env.example", "utf8")
const requiredKeys = [
  "NEXT_PUBLIC_APP_URL",
  "MONGODB_URI",
  "JWT_SECRET",
  "AUTH_SESSION_SECRET",
  "KYC_DOCUMENT_ENCRYPTION_KEY",
  "KYC_ACTIVE_KEY_VERSION",
  "KYC_PREVIOUS_KEY_VERSIONS",
  "KYC_ENCRYPTION_KEYS_JSON",
  "PAYSTACK_SECRET_KEY",
  "RESEND_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "ENABLE_MOCK_PAYMENTS",
  "ENABLE_MOCK_EMAILS",
  "ENABLE_MOCK_STELLAR",
  "FX_PROVIDER",
  "FX_STATIC_RATES_JSON",
  "FX_MAX_QUOTE_AGE_SECONDS",
  "FX_QUOTE_TTL_SECONDS",
  "FX_DEVIATION_BPS",
  "FX_MARKUP_BPS",
]

const missing = requiredKeys.filter((key) => !envExample.includes(`${key}=`))
if (missing.length > 0) {
  throw new Error(`.env.example is missing configuration keys: ${missing.join(", ")}`)
}

console.log(".env.example covers typed configuration keys.")
