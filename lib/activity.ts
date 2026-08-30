export const ACTIVITY_CATEGORIES = [
  "wallet",
  "investment",
  "repayment",
  "kyc",
  "vehicle",
  "payout",
  "stellar",
  "system",
] as const

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]

export interface ActivityItem {
  id: string
  title: string
  message: string
  category: ActivityCategory
  priority: "low" | "medium" | "high"
  link?: string
  read: boolean
  timestamp: string
}

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  wallet: "Wallet",
  investment: "Investment",
  repayment: "Repayment",
  kyc: "KYC",
  vehicle: "Vehicle",
  payout: "Payout",
  stellar: "Stellar",
  system: "System",
}

export function inferActivityCategory(type?: string): ActivityCategory {
  const value = type?.toLowerCase() || ""
  if (value.includes("wallet") || value.includes("fund")) return "wallet"
  if (value.includes("invest")) return "investment"
  if (value.includes("repay") || value.includes("payment")) return "repayment"
  if (value.includes("kyc") || value.includes("document")) return "kyc"
  if (value.includes("vehicle") || value.includes("contract")) return "vehicle"
  if (value.includes("payout") || value.includes("return")) return "payout"
  if (value.includes("stellar")) return "stellar"
  return "system"
}
