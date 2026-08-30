import { afterEach, describe, expect, it, vi } from "vitest"

import { EmailConfigurationError, isMockEmailEnabled, sendEmail } from "./email.service"

describe("email service", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns a mock result without a Resend API key", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const result = await sendEmail(
      { to: "driver@example.com", subject: "Loan update", html: "<p>Approved</p>" },
      { ENABLE_MOCK_EMAILS: "true" },
    )

    expect(result).toMatchObject({ mocked: true })
    expect(result.id).toMatch(/^mock_email_\d+$/)
    expect(log).toHaveBeenCalledWith("MOCK_EMAIL_SEND", {
      recipientsCount: 1,
      subject: "Loan update",
    })
  })

  it("does not include recipient addresses or HTML in mock logs", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined)

    await sendEmail(
      { to: ["one@example.com", "two@example.com"], subject: "Update", html: "<p>Private</p>" },
      { ENABLE_MOCK_EMAILS: "true" },
    )

    expect(JSON.stringify(log.mock.calls)).not.toContain("one@example.com")
    expect(JSON.stringify(log.mock.calls)).not.toContain("Private")
  })

  it("requires a Resend API key when mock mode is disabled", async () => {
    expect(isMockEmailEnabled({ ENABLE_MOCK_EMAILS: "false" })).toBe(false)
    await expect(
      sendEmail({ to: "driver@example.com", subject: "Update", html: "<p>Hello</p>" }, {}),
    ).rejects.toBeInstanceOf(EmailConfigurationError)
  })
})
