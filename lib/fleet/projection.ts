/**
 * Fleet projection utility to sanitize internal vendor/admin fields from driver role views.
 */

/**
 * Strips internal vendor/admin fields from a single maintenance order or document object.
 */
export function projectMaintenanceForDriver<T extends Record<string, any>>(order: T): Partial<T> {
  if (!order) return order

  const doc = typeof order.toObject === "function" ? order.toObject() : { ...order }

  delete doc.internalNotes
  delete doc.vendorContact
  delete doc.costAdjustmentHistory
  delete doc.verifiedByUserId

  return doc
}

/**
 * Strips internal notes and private fields from an array of maintenance orders.
 */
export function projectMaintenanceListForDriver<T extends Record<string, any>>(orders: T[]): Partial<T>[] {
  if (!Array.isArray(orders)) return []
  return orders.map((o) => projectMaintenanceForDriver(o))
}

/**
 * Strips internal notes from incident records for driver views.
 */
export function projectIncidentForDriver<T extends Record<string, any>>(incident: T): Partial<T> {
  if (!incident) return incident

  const doc = typeof incident.toObject === "function" ? incident.toObject() : { ...incident }

  delete doc.internalNotes

  return doc
}
