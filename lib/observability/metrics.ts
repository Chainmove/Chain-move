type MetricKey = `${string}:${string}`
const counters = new Map<MetricKey, number>()
const timings = new Map<MetricKey, number[]>()

/** Metric names are stable, low-cardinality names suitable for a future exporter. */
export function incrementMetric(name: string, outcome = "success") {
  const key: MetricKey = `${name}:${outcome}`
  counters.set(key, (counters.get(key) || 0) + 1)
}

export function recordLatency(name: string, milliseconds: number) {
  const key: MetricKey = `${name}:ms`
  const values = timings.get(key) || []
  // Bound development memory while retaining a representative recent window.
  if (values.length >= 1_000) values.shift()
  values.push(milliseconds)
  timings.set(key, values)
}

export function metricSnapshot() {
  return { counters: Object.fromEntries(counters), timings: Object.fromEntries(timings) }
}
