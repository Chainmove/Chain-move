export const NOTIFICATION_CATEGORIES = ["funding", "investment", "repayment", "kyc", "payout", "arrears", "contract"] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]
export type NotificationChannel = "in_app" | "email"
export type NotificationEvent =
  | { type: "funding.completed"; version: 1; eventId: string; userId: string; occurredAt: string; payload: { amountLabel: string } }
  | { type: "investment.confirmed"; version: 1; eventId: string; userId: string; occurredAt: string; payload: { investmentId: string } }
  | { type: "repayment.due"; version: 1; eventId: string; userId: string; occurredAt: string; payload: { dueDateLabel: string } }
  | { type: "kyc.decision"; version: 1; eventId: string; userId: string; occurredAt: string; payload: { decision: "approved" | "rejected" | "review" } }
  | { type: "payout.processed"; version: 1; eventId: string; userId: string; occurredAt: string; payload: { payoutId: string } }
  | { type: "arrears.notice"; version: 1; eventId: string; userId: string; occurredAt: string; payload: { actionByLabel: string } }
  | { type: "contract.changed"; version: 1; eventId: string; userId: string; occurredAt: string; payload: { contractId: string } }
export interface RenderedNotification { templateKey: string; templateVersion: number; category: NotificationCategory; mandatory: boolean; title: string; subject: string; text: string; html: string; actionUrl: string }
export interface NotificationPreferences { locale: string; categories: Partial<Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>> }
