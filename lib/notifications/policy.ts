export function retryDecision(attemptCount: number, maxAttempts: number, now = new Date()) {
  const nextCount = attemptCount + 1
  if (nextCount >= maxAttempts) return { status: "dead_letter" as const, nextCount, scheduledFor: null }
  return { status: "scheduled" as const, nextCount, scheduledFor: new Date(now.getTime() + Math.min(3600, 30 * 2 ** nextCount) * 1000) }
}

export function markRead<T extends { id: string; read: boolean }>(records: T[], ids: string[]) {
  const selected = new Set(ids)
  return records.map(record => selected.has(record.id) ? { ...record, read: true } : record)
}
