/**
 * Scans Loan, Vehicle, and Investment records for impossible state combinations
 * and reports (or optionally repairs) them.
 *
 * Usage:
 *   tsx scripts/check-state-machine-integrity.ts           # report only
 *   tsx scripts/check-state-machine-integrity.ts --repair  # repair detected issues
 */
import "dotenv/config"
import mongoose from "mongoose"
import Loan from "@/models/Loan"
import Vehicle from "@/models/Vehicle"
import Investment from "@/models/Investment"

const REPAIR = process.argv.includes("--repair")

async function connect() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error("MONGODB_URI is not set.")
  await mongoose.connect(uri)
  console.log("Connected to MongoDB.")
}

interface Finding {
  entityType: string
  entityId: string
  issue: string
  repairAction?: string
}

const findings: Finding[] = []

function record(entityType: string, entityId: string, issue: string, repairAction?: string) {
  findings.push({ entityType, entityId, issue, repairAction })
  console.warn(`[${entityType}] ${entityId}: ${issue}`)
}

// ── Loan checks ──────────────────────────────────────────────────────────────

async function checkLoans() {
  console.log("\n── Checking Loans ──")

  // Active loans that never had a down payment
  const activeLackingDownPayment = await Loan.find({
    status: "Active",
    downPaymentMade: { $ne: true },
  }).select("_id status downPaymentMade requestedAmount totalFunded")

  for (const loan of activeLackingDownPayment) {
    record(
      "Loan",
      loan._id.toString(),
      `Active without downPaymentMade=true (downPaymentMade=${loan.downPaymentMade})`,
      "Set status to 'Approved' pending manual verification",
    )
    if (REPAIR) {
      await Loan.updateOne({ _id: loan._id }, { $set: { status: "Approved" } })
      console.log(`  ✓ Repaired: set to Approved`)
    }
  }

  // Active loans with insufficient funding
  const activeLoanDocs = await Loan.find({ status: "Active" }).select(
    "_id requestedAmount totalFunded",
  )
  for (const loan of activeLoanDocs) {
    if (Number(loan.totalFunded) < Number(loan.requestedAmount)) {
      record(
        "Loan",
        loan._id.toString(),
        `Active but totalFunded (${loan.totalFunded}) < requestedAmount (${loan.requestedAmount})`,
        "Set status to 'Approved' pending manual funding verification",
      )
      if (REPAIR) {
        await Loan.updateOne({ _id: loan._id }, { $set: { status: "Approved" } })
        console.log(`  ✓ Repaired: set to Approved`)
      }
    }
  }

  // Completed loans whose vehicle is still Financed
  const completedLoans = await Loan.find({ status: "Completed" }).select("_id vehicleId")
  for (const loan of completedLoans) {
    const vehicle = await Vehicle.findById(loan.vehicleId).select("_id status").lean()
    if (vehicle && vehicle.status === "Financed") {
      record(
        "Loan",
        loan._id.toString(),
        `Completed loan but associated vehicle (${vehicle._id}) is still Financed`,
        "Set vehicle to Available",
      )
      if (REPAIR) {
        await Vehicle.updateOne(
          { _id: vehicle._id },
          { $set: { status: "Available", fundingStatus: "Open" }, $unset: { driverId: 1 } },
        )
        console.log(`  ✓ Repaired vehicle ${vehicle._id}: set to Available`)
      }
    }
  }

  // Rejected/Cancelled loans whose vehicle is still Reserved
  const closedLoans = await Loan.find({
    status: { $in: ["Rejected", "Cancelled"] },
  }).select("_id vehicleId status")
  for (const loan of closedLoans) {
    const vehicle = await Vehicle.findById(loan.vehicleId).select("_id status").lean()
    if (vehicle && vehicle.status === "Reserved") {
      record(
        "Loan",
        loan._id.toString(),
        `${loan.status} loan but associated vehicle (${vehicle._id}) is still Reserved`,
        "Set vehicle to Available",
      )
      if (REPAIR) {
        await Vehicle.updateOne(
          { _id: vehicle._id },
          { $set: { status: "Available" }, $unset: { driverId: 1 } },
        )
        console.log(`  ✓ Repaired vehicle ${vehicle._id}: set to Available`)
      }
    }
  }

  // Loans in impossible enum values (legacy 'Cancelled' before it was added)
  const invalidStatusLoans = await Loan.find({
    status: { $nin: ["Pending", "Under Review", "Approved", "Rejected", "Active", "Completed", "Cancelled"] },
  }).select("_id status")
  for (const loan of invalidStatusLoans) {
    record("Loan", loan._id.toString(), `Unknown status value: '${loan.status}'`)
  }

  console.log(`  Checked ${completedLoans.length + closedLoans.length + activeLoanDocs.length} loans.`)
}

// ── Vehicle checks ────────────────────────────────────────────────────────────

async function checkVehicles() {
  console.log("\n── Checking Vehicles ──")

  // Financed vehicles with no active loan
  const financedVehicles = await Vehicle.find({ status: "Financed" }).select("_id status driverId")
  for (const vehicle of financedVehicles) {
    const activeLoan = await Loan.findOne({
      vehicleId: vehicle._id,
      status: "Active",
    })
      .select("_id")
      .lean()
    if (!activeLoan) {
      record(
        "Vehicle",
        vehicle._id.toString(),
        "Financed with no matching Active loan",
        "Set status to Available",
      )
      if (REPAIR) {
        await Vehicle.updateOne(
          { _id: vehicle._id },
          { $set: { status: "Available" }, $unset: { driverId: 1 } },
        )
        console.log(`  ✓ Repaired: set to Available`)
      }
    }
  }

  // Reserved vehicles with no pending/review/approved loan
  const reservedVehicles = await Vehicle.find({ status: "Reserved" }).select("_id status")
  for (const vehicle of reservedVehicles) {
    const pendingLoan = await Loan.findOne({
      vehicleId: vehicle._id,
      status: { $in: ["Pending", "Under Review", "Approved"] },
    })
      .select("_id")
      .lean()
    if (!pendingLoan) {
      record(
        "Vehicle",
        vehicle._id.toString(),
        "Reserved with no matching in-progress loan",
        "Set status to Available",
      )
      if (REPAIR) {
        await Vehicle.updateOne(
          { _id: vehicle._id },
          { $set: { status: "Available" }, $unset: { driverId: 1 } },
        )
        console.log(`  ✓ Repaired: set to Available`)
      }
    }
  }

  // Retired vehicles that still have a driverId set
  const retiredWithDriver = await Vehicle.find({
    status: "Retired",
    driverId: { $exists: true },
  }).select("_id status driverId")
  for (const vehicle of retiredWithDriver) {
    record(
      "Vehicle",
      vehicle._id.toString(),
      "Retired vehicle still has driverId set",
      "Unset driverId",
    )
    if (REPAIR) {
      await Vehicle.updateOne({ _id: vehicle._id }, { $unset: { driverId: 1 } })
      console.log(`  ✓ Repaired: unset driverId`)
    }
  }

  console.log(
    `  Checked ${financedVehicles.length + reservedVehicles.length + retiredWithDriver.length} vehicles.`,
  )
}

// ── Investment checks ─────────────────────────────────────────────────────────

async function checkInvestments() {
  console.log("\n── Checking Investments ──")

  // Active investments whose loan is Completed/Rejected/Cancelled
  const activeInvestments = await Investment.find({ status: "Active" }).select(
    "_id loanId vehicleId status",
  )
  for (const inv of activeInvestments) {
    if (inv.loanId) {
      const loan = await Loan.findById(inv.loanId).select("_id status").lean()
      if (loan && ["Completed", "Rejected", "Cancelled"].includes(loan.status)) {
        record(
          "Investment",
          inv._id.toString(),
          `Active but associated loan ${inv.loanId} is ${loan.status}`,
          loan.status === "Completed" ? "Set to Completed" : "Set to Funding (loan never activated)",
        )
        if (REPAIR) {
          const targetStatus = loan.status === "Completed" ? "Completed" : "Funding"
          await Investment.updateOne({ _id: inv._id }, { $set: { status: targetStatus } })
          console.log(`  ✓ Repaired: set to ${targetStatus}`)
        }
      }
    }
  }

  // Investments with legacy 'Active' default that were created for unfunded loans
  const fundingVehicleIds = await Vehicle.find({ fundingStatus: "Open" }).distinct("_id")
  const mistakenActiveInvestments = await Investment.find({
    status: "Active",
    vehicleId: { $in: fundingVehicleIds },
  }).select("_id vehicleId")
  for (const inv of mistakenActiveInvestments) {
    record(
      "Investment",
      inv._id.toString(),
      `Status is Active but vehicle ${inv.vehicleId} fundingStatus is Open — likely pre-state-machine record`,
      "Set to Funding",
    )
    if (REPAIR) {
      await Investment.updateOne({ _id: inv._id }, { $set: { status: "Funding" } })
      console.log(`  ✓ Repaired: set to Funding`)
    }
  }

  console.log(`  Checked ${activeInvestments.length + mistakenActiveInvestments.length} investments.`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await connect()
  console.log(`\nState machine integrity check — mode: ${REPAIR ? "REPAIR" : "REPORT ONLY"}\n`)

  await checkLoans()
  await checkVehicles()
  await checkInvestments()

  console.log(`\n────────────────────────────────────────`)
  console.log(`Total findings: ${findings.length}`)

  if (findings.length === 0) {
    console.log("✅ No integrity issues found.")
  } else if (!REPAIR) {
    console.log("⚠️  Run with --repair to fix the issues above.")
    console.log("\nFindings summary:")
    for (const f of findings) {
      console.log(`  [${f.entityType}] ${f.entityId}: ${f.issue}`)
      if (f.repairAction) console.log(`    → repair: ${f.repairAction}`)
    }
    process.exit(1)
  } else {
    console.log("✅ Repair completed. Review the changes above.")
  }

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
