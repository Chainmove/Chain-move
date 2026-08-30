import { TransactionLedger } from "@/components/dashboard/ledger/transaction-ledger"
import { requireAdminAccess } from "@/src/server/admin/require-admin"

export const dynamic = "force-dynamic"

export default async function AdminLedgerPage() {
  await requireAdminAccess()

  return (
    <TransactionLedger
      role="admin"
      title="Transaction Ledger"
      description="Global wallet ledger across investors, drivers, and admins with reconciliation views."
    />
  )
}
