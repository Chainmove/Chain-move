import dbConnect from "@/lib/dbConnect"
import { expireInvestmentReservations } from "@/lib/services/investments.service"

async function main() {
  await dbConnect()
  const expired = await expireInvestmentReservations()
  console.log(`Expired and released ${expired} investment reservation(s).`)
}

main().catch((error) => {
  console.error("INVESTMENT_RESERVATION_EXPIRY_FAILED", error)
  process.exitCode = 1
})
