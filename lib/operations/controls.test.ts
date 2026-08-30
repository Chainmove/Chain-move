import { strict as assert } from "node:assert"
import { evaluateOperationalControl, ProviderCircuitBreaker, validateControlChange, type OperationalControl } from "./controls"

const control: OperationalControl = {
  id: "ctrl-1", version: 1, operation: "wallet.fund", state: "paused",
  reason: "Provider incident", incidentId: "INC-7", actorId: "admin-a",
  startsAt: new Date("2026-07-20T10:00:00Z"),
}
assert.equal(evaluateOperationalControl("wallet.fund", [control], { now: new Date("2026-07-20T11:00:00Z") }).allowed, false)
assert.equal(evaluateOperationalControl("wallet.debit", [control]).allowed, true)
assert.equal(evaluateOperationalControl("wallet.fund", null).code, "CONTROL_UNAVAILABLE")
assert.equal(evaluateOperationalControl("wallet.fund", [control], { idempotentCompletion: true }).allowed, true)

const breaker = new ProviderCircuitBreaker({ failureThreshold: 2, windowMs: 1_000, recoveryMs: 100 })
breaker.recordFailure(0)
breaker.recordFailure(1)
assert.equal(breaker.canRequest(50), false)
assert.equal(breaker.canRequest(101), true)
breaker.recordSuccess()
assert.equal(breaker.snapshot().state, "closed")

assert.throws(() => validateControlChange({ ...control, operation: "*", approvedBy: undefined }))
assert.doesNotThrow(() => validateControlChange({ ...control, operation: "*", approvedBy: "admin-b" }))
