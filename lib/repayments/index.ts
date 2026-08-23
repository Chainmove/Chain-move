/**
 * Repayments module barrel export.
 * Import from "@/lib/repayments" to access the full engine API.
 */

export * from "./allocation-engine"
export * from "./schedule-generator"
export {
  applyDriverPayment,
  reverseDriverPayment,
  getArrearsReport,
  checkContractSchedule,
  repairContractBalance,
} from "./repayment-engine.service"
export type {
  ApplyPaymentInput,
  ApplyPaymentResult,
  ReversePaymentInput,
  ReversePaymentResult,
  ArrearsReport,
  ScheduleCheckResult,
} from "./repayment-engine.service"
