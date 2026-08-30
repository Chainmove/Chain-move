import { strict as assert } from "node:assert"
import { calculateReviewDeadline, evaluateRiskEvent, replayRiskEvents, type RiskEvent } from "./engine"

const event: RiskEvent = {
  id: "evt-1",
  type: "payment.failed",
  subjectId: "user-1",
  occurredAt: new Date("2026-07-20T10:00:00Z"),
  attributes: { failedAttempts: 3 },
}

const signals = evaluateRiskEvent(event, undefined, [], new Date("2026-07-20T10:01:00Z"))
assert.equal(signals.length, 1)
assert.equal(signals[0].ruleCode, "PAYMENT_FAILURE_BURST")
assert.match(signals[0].explanation, /threshold/)
assert.equal(evaluateRiskEvent({ ...event, attributes: { failedAttempts: 2 } }).length, 0)
assert.equal(
  evaluateRiskEvent(event, undefined, [{ ruleCode: signals[0].ruleCode, reason: "Known test", expiresAt: new Date("2099-01-01") }]).length,
  0
)
assert.equal(calculateReviewDeadline("critical", event.occurredAt).toISOString(), "2026-07-20T11:00:00.000Z")

async function* history() {
  yield event
  yield event
}
const keys = new Set<string>()
const replay = await replayRiskEvents(history(), async (signal) => {
  if (keys.has(signal.dedupeKey)) return "duplicate"
  keys.add(signal.dedupeKey)
  return "created"
}, { from: new Date("2026-07-20"), to: new Date("2026-07-21"), limit: 10 })
assert.deepEqual(replay, { scanned: 2, created: 1 })
