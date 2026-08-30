import { SettlementRail } from "@/models/SettlementRecord"

export interface RailSettlementConfig {
  rail: SettlementRail
  finalityThreshold: number
  pendingTimeoutMs: number
  observedTimeoutMs: number
  autoExpireOnTimeout: boolean
}

const DEFAULT_CONFIGS: Record<string, Record<SettlementRail, RailSettlementConfig>> = {
  production: {
    paystack: {
      rail: "paystack",
      finalityThreshold: 1,
      pendingTimeoutMs: 15 * 60 * 1000, // 15 minutes
      observedTimeoutMs: 30 * 60 * 1000,
      autoExpireOnTimeout: false,
    },
    stellar: {
      rail: "stellar",
      finalityThreshold: 3, // 3 ledger confirmations
      pendingTimeoutMs: 5 * 60 * 1000, // 5 minutes
      observedTimeoutMs: 10 * 60 * 1000,
      autoExpireOnTimeout: false,
    },
    bank_transfer: {
      rail: "bank_transfer",
      finalityThreshold: 1,
      pendingTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
      observedTimeoutMs: 48 * 60 * 60 * 1000,
      autoExpireOnTimeout: false,
    },
    internal_ledger: {
      rail: "internal_ledger",
      finalityThreshold: 1,
      pendingTimeoutMs: 5 * 60 * 1000,
      observedTimeoutMs: 5 * 60 * 1000,
      autoExpireOnTimeout: true,
    },
  },
  development: {
    paystack: {
      rail: "paystack",
      finalityThreshold: 1,
      pendingTimeoutMs: 5 * 60 * 1000,
      observedTimeoutMs: 10 * 60 * 1000,
      autoExpireOnTimeout: true,
    },
    stellar: {
      rail: "stellar",
      finalityThreshold: 1,
      pendingTimeoutMs: 2 * 60 * 1000,
      observedTimeoutMs: 5 * 60 * 1000,
      autoExpireOnTimeout: true,
    },
    bank_transfer: {
      rail: "bank_transfer",
      finalityThreshold: 1,
      pendingTimeoutMs: 60 * 60 * 1000,
      observedTimeoutMs: 120 * 60 * 1000,
      autoExpireOnTimeout: false,
    },
    internal_ledger: {
      rail: "internal_ledger",
      finalityThreshold: 1,
      pendingTimeoutMs: 60 * 1000,
      observedTimeoutMs: 60 * 1000,
      autoExpireOnTimeout: true,
    },
  },
}

export function getRailSettlementConfig(rail: SettlementRail, env = process.env.NODE_ENV || "development"): RailSettlementConfig {
  const envKey = env === "production" ? "production" : "development"
  return DEFAULT_CONFIGS[envKey][rail] || DEFAULT_CONFIGS.development[rail]
}
