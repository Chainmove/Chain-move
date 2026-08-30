import { buildStellarReferenceUrl, getStellarDisplayConfig } from "@/lib/stellar/display-config"

export type StellarActivityStatus = "Confirmed" | "Pending" | "Failed"

export interface StellarActivityItem {
  id: string
  type: string
  amount: string
  asset: string
  date: string
  status: StellarActivityStatus
  reference?: string | null
}

export interface StellarActivityFeed {
  linkedAccount: string | null
  activities: StellarActivityItem[]
}

const DEMO_ACTIVITIES: StellarActivityItem[] = [
  {
    id: "stellar-activity-1",
    type: "Repayment settlement",
    amount: "120.00",
    asset: "XLM",
    date: "2026-06-12T09:30:00Z",
    status: "Confirmed",
    reference: "f2f6b7c8c9d04de1b7e6a31d5b8f1b57c3f3d0a0d8a1b4e7c1c7e4f6b7c8d9a0",
  },
  {
    id: "stellar-activity-2",
    type: "Asset transfer",
    amount: "245.50",
    asset: "USDC",
    date: "2026-06-10T15:20:00Z",
    status: "Pending",
    reference: "c1f1b3d1f4aa4f4c9c23f4f2f1e0d5b6a8c2e3f4d5c6b7a8c9d0e1f2a3b4c5d6",
  },
  {
    id: "stellar-activity-3",
    type: "Payout allocation",
    amount: "88.00",
    asset: "XLM",
    date: "2026-06-08T12:05:00Z",
    status: "Confirmed",
  },
]

export function createMockStellarActivityFeed(linkedAccount: string | null): StellarActivityFeed {
  if (!linkedAccount) {
    return {
      linkedAccount: null,
      activities: [],
    }
  }

  const config = getStellarDisplayConfig()

  return {
    linkedAccount,
    activities: DEMO_ACTIVITIES.map((activity) => ({
      ...activity,
      reference: activity.reference ? buildStellarReferenceUrl(activity.reference, config) : null,
    })),
  }
}
