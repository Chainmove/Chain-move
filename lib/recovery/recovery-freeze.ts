/**
 * Action freeze during wallet recovery.
 *
 * When a recovery is active, high-risk actions are frozen while safe
 * read-only access and required repayments remain available.
 *
 * Frozen actions:
 *  - Stellar wallet linking / replacement
 *  - Investment withdrawals
 *  - Payout approvals
 *  - Role changes
 *  - KYC approval decisions
 *
 * Always permitted (never frozen):
 *  - Read-only data access
 *  - Loan repayments (required contractual obligation)
 *  - Recovery flow itself (cancel, dispute, status)
 */

import WalletRecovery from "@/models/WalletRecovery"

export type HighRiskAction =
  | "stellar_link"
  | "investment_withdrawal"
  | "payout_approval"
  | "role_change"
  | "kyc_decision"

export const FROZEN_ACTIONS: ReadonlySet<HighRiskAction> = new Set<HighRiskAction>([
  "stellar_link",
  "investment_withdrawal",
  "payout_approval",
  "role_change",
  "kyc_decision",
])

export interface FreezeCheckResult {
  frozen: boolean
  recoveryId?: string
  reason?: string
}

/**
 * Returns frozen=true if the user has an active recovery request and the
 * given action is in the frozen set.
 */
export async function checkActionFrozen(
  userId: string,
  action: HighRiskAction,
): Promise<FreezeCheckResult> {
  if (!FROZEN_ACTIONS.has(action)) {
    return { frozen: false }
  }

  const activeRecovery = await WalletRecovery.findOne({
    userId,
    state: { $in: ["requested", "challenged", "cooling_off", "approved"] },
  })
    .select("_id state")
    .lean()

  if (!activeRecovery) {
    return { frozen: false }
  }

  return {
    frozen: true,
    recoveryId: activeRecovery._id.toString(),
    reason: `This action is frozen while a wallet recovery request (${activeRecovery._id}) is in progress. Cancel the recovery or wait for it to complete.`,
  }
}
