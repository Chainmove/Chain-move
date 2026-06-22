import { Resend } from "resend"

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html: string
  from?: string
}

export interface SendEmailResult {
  id: string
  mocked: boolean
}

export interface EmailEnvironment {
  ENABLE_MOCK_EMAILS?: string
  RESEND_API_KEY?: string
  NODE_ENV?: string
}

export class EmailConfigurationError extends Error {
  constructor() {
    super("Email service is not configured")
    this.name = "EmailConfigurationError"
  }
}

export class EmailDeliveryError extends Error {
  constructor(message = "Unable to send email") {
    super(message)
    this.name = "EmailDeliveryError"
  }
}

let resendClient: Resend | null = null
let resendApiKey: string | null = null

export function isMockEmailEnabled(env: EmailEnvironment = process.env): boolean {
  return env.ENABLE_MOCK_EMAILS?.trim().toLowerCase() === "true"
}

function getResendClient(apiKey: string): Resend {
  if (!resendClient || resendApiKey !== apiKey) {
    resendClient = new Resend(apiKey)
    resendApiKey = apiKey
  }
  return resendClient
}

export async function sendEmail(
  input: SendEmailInput,
  env: EmailEnvironment = process.env,
): Promise<SendEmailResult> {
  if (isMockEmailEnabled(env)) {
    console.info("MOCK_EMAIL_SEND", {
      recipientsCount: Array.isArray(input.to) ? input.to.length : 1,
      subject: input.subject,
    })
    return { id: `mock_email_${Date.now()}`, mocked: true }
  }

  const apiKey = env.RESEND_API_KEY?.trim()
  if (!apiKey) throw new EmailConfigurationError()

  const { data, error } = await getResendClient(apiKey).emails.send({
    from: input.from || "onboarding@chainmove.xyz",
    to: input.to,
    subject: input.subject,
    html: input.html,
  })

  if (error) throw new EmailDeliveryError(error.message)
  if (!data?.id) throw new EmailDeliveryError("Email provider returned no delivery ID")

  return { id: data.id, mocked: false }
}
