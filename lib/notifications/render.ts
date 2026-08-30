import type { NotificationEvent, RenderedNotification } from "./types"
import { safeApplicationUrl } from "./templates"

const metadata = {
  "funding.completed": ["funding", false, "Funding received", "/dashboard/investor"],
  "investment.confirmed": ["investment", false, "Investment confirmed", "/dashboard/investor/investments"],
  "repayment.due": ["repayment", true, "Repayment due", "/dashboard/driver/repayments"],
  "kyc.decision": ["kyc", true, "KYC status updated", "/dashboard/driver/kyc/status"],
  "payout.processed": ["payout", true, "Payout processed", "/dashboard/investor"],
  "arrears.notice": ["arrears", true, "Account action required", "/dashboard/driver"],
  "contract.changed": ["contract", true, "Contract updated", "/dashboard/driver"],
} as const

export function renderNotification(event: NotificationEvent): RenderedNotification {
  const parsed = (event.type === "kyc.decision" ? schemas.kyc : schemas.text).parse(event.payload)
  const [category, mandatory, title, path] = metadata[event.type]
  const p = parsed as Record<string, string>
  const body = event.type === "funding.completed" ? `Your funding of ${p.amountLabel} was received.`
    : event.type === "repayment.due" ? `A repayment is due ${p.dueDateLabel}.`
    : event.type === "kyc.decision" ? `Your KYC status is now ${p.decision}. Sign in for details.`
    : event.type === "arrears.notice" ? `Please review your account by ${p.actionByLabel}.`
    : event.type === "contract.changed" ? "A contract associated with your account has changed. Sign in to review it."
    : event.type === "payout.processed" ? "Your payout status has been updated. Sign in for details."
    : "Your investment has been confirmed."
  const actionUrl = safeApplicationUrl(path)
  const escape = (v: string) => v.replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[c]!)
  return { templateKey: event.type, templateVersion: 1, category, mandatory, title, subject: `ChainMove: ${title}`, text: body, html: `<div><h2>${escape(title)}</h2><p>${escape(body)}</p><a href="${escape(actionUrl)}">Open ChainMove</a></div>`, actionUrl }
}

import { z } from "zod"
const safeText = z.string().trim().min(1).max(80)
const schemas = { text: z.record(z.string(), safeText), kyc: z.object({ decision: z.enum(["approved", "rejected", "review"]) }) }
