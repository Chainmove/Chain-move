import { z } from "zod"
import type { NotificationEvent, RenderedNotification } from "./types"

export function safeApplicationUrl(path: string, originValue = process.env.NEXT_PUBLIC_APP_URL || "https://chainmove.xyz") {
  const origin = new URL(originValue)
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") throw new Error("Application URL must use HTTPS")
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("Unsafe notification URL")
  const url = new URL(path, origin)
  if (url.origin !== origin.origin) throw new Error("Unsafe notification URL")
  return url.toString()
}
const text = z.string().trim().min(1).max(80)
const schemas = {
  "funding.completed": z.object({ amountLabel: text.max(40) }),
  "investment.confirmed": z.object({ investmentId: text }),
  "repayment.due": z.object({ dueDateLabel: text }),
  "kyc.decision": z.object({ decision: z.enum(["approved", "rejected", "review"]) }),
  "payout.processed": z.object({ payoutId: text }),
  "arrears.notice": z.object({ actionByLabel: text }),
  "contract.changed": z.object({ contractId: text }),
} as const
const defs = {
  "funding.completed": ["funding", false, "Funding received", "/dashboard/investor"],
  "investment.confirmed": ["investment", false, "Investment confirmed", "/dashboard/investor/investments"],
  "repayment.due": ["repayment", true, "Repayment due", "/dashboard/driver/repayments"],
  "kyc.decision": ["kyc", true, "KYC status updated", "/dashboard/driver/kyc/status"],
  "payout.processed": ["payout", true, "Payout processed", "/dashboard/investor"],
  "arrears.notice": ["arrears", true, "Account action required", "/dashboard/driver"],
  "contract.changed": ["contract", true, "Contract updated", "/dashboard/driver"],
} as const
