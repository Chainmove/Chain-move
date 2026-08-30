import type { Db } from "mongodb"

export type FixtureDataset = {
  collectionCount: number
  documentCount: number
  collections: Record<string, number>
}

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]
}

function randomId(rand: () => number): string {
  const chars = "abcdef0123456789"
  let result = ""
  for (let i = 0; i < 24; i++) {
    result += chars[Math.floor(rand() * chars.length)]
  }
  return result
}

function randomDate(rand: () => number, startYear = 2023, endYear = 2025): Date {
  const start = new Date(startYear, 0, 1).getTime()
  const end = new Date(endYear, 11, 31).getTime()
  return new Date(start + rand() * (end - start))
}

function generateUsers(rand: () => number): Record<string, unknown>[] {
  const users: Record<string, unknown>[] = []
  const roles: Array<"driver" | "investor" | "admin"> = ["driver", "investor", "admin"]
  const statuses = ["none", "pending", "approved_stage1", "approved_stage2", "rejected"]

  for (let i = 0; i < 12; i++) {
    const role = i < 6 ? "driver" : i < 10 ? "investor" : "admin"
    const id = randomId(rand)
    users.push({
      _id: { $oid: id },
      name: `Test User ${i + 1}`,
      email: `user${i + 1}@drill-test.example.com`,
      role,
      kycStatus: pick(statuses, rand),
      kycDocuments: [],
      availableBalance: Math.floor(rand() * 1000000),
      totalInvested: Math.floor(rand() * 500000),
      totalReturns: Math.floor(rand() * 200000),
      createdAt: randomDate(rand),
      updatedAt: randomDate(rand),
    })
  }
  return users
}

function generateVehicles(rand: () => number): Record<string, unknown>[] {
  const types = ["shuttle", "keke"]
  const statuses = ["Available", "Financed", "Reserved", "Maintenance"]
  const fundingStatuses = ["Open", "Funded", "Active"]
  const vehicles: Record<string, unknown>[] = []

  for (let i = 0; i < 5; i++) {
    const id = randomId(rand)
    vehicles.push({
      _id: { $oid: id },
      name: `Vehicle ${i + 1}`,
      type: pick(types, rand),
      year: 2022 + Math.floor(rand() * 3),
      price: 5000000 + Math.floor(rand() * 10000000),
      roi: 12 + Math.floor(rand() * 8),
      status: pick(statuses, rand),
      fundingStatus: pick(fundingStatuses, rand),
      totalFundedAmount: Math.floor(rand() * 5000000),
    })
  }
  return vehicles
}

function generateTransactions(rand: () => number): Record<string, unknown>[] {
  const types = ["wallet_funding", "investment", "withdrawal", "repayment", "fee"]
  const statuses = ["Pending", "Completed", "Failed"]
  const txns: Record<string, unknown>[] = []

  for (let i = 0; i < 20; i++) {
    txns.push({
      _id: { $oid: randomId(rand) },
      userId: randomId(rand),
      type: pick(types, rand),
      amount: Math.floor(rand() * 1000000),
      currency: "NGN",
      status: pick(statuses, rand),
      createdAt: randomDate(rand),
    })
  }
  return txns
}

function generateAuditLogs(rand: () => number): Record<string, unknown>[] {
  const actions = ["kyc.status.update", "user.create", "vehicle.update", "payment.process"]
  const targets = ["user", "vehicle", "transaction", "investment"]
  const logs: Record<string, unknown>[] = []

  for (let i = 0; i < 15; i++) {
    logs.push({
      _id: { $oid: randomId(rand) },
      action: pick(actions, rand),
      targetType: pick(targets, rand),
      status: pick(["success", "failure"], rand),
      createdAt: randomDate(rand),
    })
  }
  return logs
}

function generateNotifications(rand: () => number): Record<string, unknown>[] {
  const categories = ["kyc", "payment", "system", "investment"]
  const notifs: Record<string, unknown>[] = []

  for (let i = 0; i < 8; i++) {
    notifs.push({
      _id: { $oid: randomId(rand) },
      userId: `user${i + 1}`,
      title: `Notification ${i + 1}`,
      message: `This is test notification ${i + 1} for drill.`,
      category: pick(categories, rand),
      priority: pick(["low", "medium", "high"], rand),
      read: rand() > 0.5,
      timestamp: randomDate(rand),
    })
  }
  return notifs
}

function generatePoolInvestments(rand: () => number): Record<string, unknown>[] {
  const investments: Record<string, unknown>[] = []

  for (let i = 0; i < 6; i++) {
    investments.push({
      _id: { $oid: randomId(rand) },
      poolId: randomId(rand),
      userId: randomId(rand),
      amountNgn: 100000 + Math.floor(rand() * 900000),
      ownershipUnits: Math.floor(rand() * 100),
      ownershipBps: Math.floor(rand() * 10000),
      status: pick(["PENDING", "CONFIRMED", "FAILED"], rand),
      createdAt: randomDate(rand),
    })
  }
  return investments
}

function generateHirePurchaseContracts(rand: () => number): Record<string, unknown>[] {
  const contracts: Record<string, unknown>[] = []
  const statuses = ["ACTIVE", "COMPLETED", "DELINQUENT"]

  for (let i = 0; i < 4; i++) {
    contracts.push({
      _id: { $oid: randomId(rand) },
      driverUserId: randomId(rand),
      poolId: randomId(rand),
      assetType: pick(["SHUTTLE", "KEKE"], rand),
      principalNgn: 5000000 + Math.floor(rand() * 10000000),
      weeklyPaymentNgn: 100000 + Math.floor(rand() * 200000),
      status: pick(statuses, rand),
      totalPaidNgn: Math.floor(rand() * 5000000),
      createdAt: randomDate(rand),
    })
  }
  return contracts
}

function generateExchangeRateQuotes(rand: () => number): Record<string, unknown>[] {
  const quotes: Record<string, unknown>[] = []

  for (let i = 0; i < 5; i++) {
    quotes.push({
      _id: { $oid: randomId(rand) },
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      rate: 1500 + Math.floor(rand() * 500),
      status: pick(["created", "locked", "consumed", "expired"], rand),
      createdAt: randomDate(rand),
    })
  }
  return quotes
}

export async function generateFixtures(db: Db, seed: number): Promise<FixtureDataset> {
  const rand = seededRandom(seed)

  const generators: Array<{ name: string; generator: () => Record<string, unknown>[] }> = [
    { name: "users", generator: () => generateUsers(rand) },
    { name: "vehicles", generator: () => generateVehicles(rand) },
    { name: "transactions", generator: () => generateTransactions(rand) },
    { name: "auditlogs", generator: () => generateAuditLogs(rand) },
    { name: "notifications", generator: () => generateNotifications(rand) },
    { name: "poolinvestments", generator: () => generatePoolInvestments(rand) },
    { name: "hirepurchasecontracts", generator: () => generateHirePurchaseContracts(rand) },
    { name: "exchangeratequotes", generator: () => generateExchangeRateQuotes(rand) },
  ]

  const collections: Record<string, number> = {}
  let totalDocuments = 0

  for (const { name, generator } of generators) {
    const docs = generator()
    const collection = db.collection(name)
    await collection.deleteMany({})
    if (docs.length > 0) {
      await collection.insertMany(docs)
    }
    collections[name] = docs.length
    totalDocuments += docs.length
  }

  return {
    collectionCount: Object.keys(collections).length,
    documentCount: totalDocuments,
    collections,
  }
}

export async function cleanupFixtures(db: Db, collectionNames: string[]): Promise<void> {
  for (const name of collectionNames) {
    try {
      await db.collection(name).deleteMany({})
    } catch {
      // Collection may not exist
    }
  }
}
