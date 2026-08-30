export type ApprovalErrorCode =
  | "target_not_found"
  | "invalid_command"
  | "already_in_flight"
  | "not_found"
  | "not_pending"
  | "expired"
  | "self_approval"
  | "forbidden"
  | "conflict"
  | "requester_permission_revoked"
  | "approver_permission_revoked"
  | "stale_resource"
  | "business_rule_violated"
  | "execution_failed"

export class ApprovalError extends Error {
  code: ApprovalErrorCode

  constructor(code: ApprovalErrorCode, message: string) {
    super(message)
    this.name = "ApprovalError"
    this.code = code
  }
}
