/**
 * Notification dispatch for wallet recovery events.
 *
 * Sends alerts to every registered contact channel when:
 *  - A recovery is requested (warning + cancellation instructions)
 *  - Cooling-off begins (72-hour countdown notice)
 *  - Recovery is executed (confirmation + rebind details)
 *  - Recovery is cancelled (confirmation)
 *  - Recovery is disputed (escalation alert)
 *
 * Notifications are fire-and-forget; a delivery failure must never block
 * a recovery state transition.
 */

import type { IWalletRecovery } from "@/models/WalletRecovery"

export type RecoveryNotificationEvent =
  | "recovery_requested"
  | "cooling_off_started"
  | "recovery_approved"
  | "recovery_executed"
  | "recovery_cancelled"
  | "recovery_disputed"

interface NotificationPayload {
  event: RecoveryNotificationEvent
  recovery: Pick<IWalletRecovery, "userId" | "network" | "oldWalletAddress" | "newWalletAddress" | "coolingOffEndsAt" | "state">
  channels: string[]
}

function buildMessage(event: RecoveryNotificationEvent, recovery: NotificationPayload["recovery"]): string {
  const old = `${recovery.oldWalletAddress.slice(0, 8)}…`
  const next = `${recovery.newWalletAddress.slice(0, 8)}…`

  switch (event) {
    case "recovery_requested":
      return (
        `⚠️ A wallet recovery has been requested for your account. ` +
        `Old wallet: ${old}. New wallet: ${next}. ` +
        `If this was not you, cancel immediately using your old wallet.`
      )
    case "cooling_off_started": {
      const endsAt = recovery.coolingOffEndsAt?.toISOString() ?? "72 hours from now"
      return (
        `Your wallet recovery is in the 72-hour cooling-off period (ends ${endsAt}). ` +
        `If you did not initiate this, cancel now using your old wallet before the period expires.`
      )
    }
    case "recovery_approved":
      return (
        `Your wallet recovery has been approved by a reviewer. ` +
        `It will execute after the cooling-off period unless you cancel.`
      )
    case "recovery_executed":
      return (
        `✅ Your wallet has been successfully migrated from ${old} to ${next}. ` +
        `All future transactions will reference the new wallet. Historical records remain unchanged.`
      )
    case "recovery_cancelled":
      return `Your wallet recovery request has been cancelled. No changes were made to your wallet.`
    case "recovery_disputed":
      return (
        `🚨 Your wallet recovery has been disputed and placed under manual review. ` +
        `Our security team will contact you within 24 hours.`
      )
  }
}

/**
 * Sends recovery notifications to all registered channels.
 * Always resolves — never throws so callers don't need try/catch.
 */
export async function sendRecoveryNotifications(
  event: RecoveryNotificationEvent,
  recovery: NotificationPayload["recovery"],
  channels: string[],
): Promise<void> {
  const message = buildMessage(event, recovery)

  const dispatches = channels.map(async (channel) => {
    try {
      // In production: route to email/SMS provider based on channel format.
      // Here we log structured output that can be picked up by notification workers.
      console.log(
        JSON.stringify({
          recoveryNotification: {
            event,
            channel,
            userId: recovery.userId,
            message,
            sentAt: new Date().toISOString(),
          },
        }),
      )
    } catch {
      // Swallow per-channel failures to avoid blocking the recovery flow.
    }
  })

  await Promise.allSettled(dispatches)
}
