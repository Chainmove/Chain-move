import { CheckCircle, Receipt, AlertTriangle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatNaira } from "@/lib/currency"
import type { DriverPaymentSnapshot } from "@/lib/services/driver-contracts.service"

interface DriverPaymentsTableProps {
  payments: DriverPaymentSnapshot[]
  emptyLabel?: string
}

function formatDateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleString("en-NG", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function renderStatusBadge(status: DriverPaymentSnapshot["status"]) {
  if (status === "CONFIRMED") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        <CheckCircle className="mr-1 h-3.5 w-3.5" />
        Confirmed
      </Badge>
    )
  }

  if (status === "FAILED") {
    return (
      <Badge className="bg-red-600 text-white hover:bg-red-600">
        <AlertTriangle className="mr-1 h-3.5 w-3.5" />
        Failed
      </Badge>
    )
  }

  return (
    <Badge variant="secondary">
      <Receipt className="mr-1 h-3.5 w-3.5" />
      Pending
    </Badge>
  )
}

export function DriverPaymentsTable({ payments, emptyLabel = "No payment records available yet." }: DriverPaymentsTableProps) {
  if (payments.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3 md:hidden">
        {payments.map((payment) => (
          <article key={payment.id} className="rounded-[10px] border border-border/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{formatDateLabel(payment.createdAt)}</p>
                <p className="mt-1 text-sm font-semibold">{formatNaira(payment.amountNgn)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Applied: {formatNaira(payment.appliedAmountNgn)}</p>
              </div>
              {renderStatusBadge(payment.status)}
            </div>
            <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
              <p>Method: {payment.method}</p>
              {payment.overpaymentNgn > 0 ? <p>Overpayment credited: {formatNaira(payment.overpaymentNgn)}</p> : null}
              <p className="truncate">Reference: {payment.paystackRef}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-[10px] border border-border/70 md:block">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead>Overpayment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell className="text-xs">{formatDateLabel(payment.createdAt)}</TableCell>
                <TableCell className="font-medium">{formatNaira(payment.amountNgn)}</TableCell>
                <TableCell>{formatNaira(payment.appliedAmountNgn)}</TableCell>
                <TableCell>{payment.overpaymentNgn > 0 ? formatNaira(payment.overpaymentNgn) : "—"}</TableCell>
                <TableCell>{renderStatusBadge(payment.status)}</TableCell>
                <TableCell className="text-xs">{payment.method}</TableCell>
                <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">{payment.paystackRef}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
