import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react"

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
import type { DriverRepaymentScheduleItem } from "@/lib/services/driver-contracts.service"

interface RepaymentScheduleTableProps {
  schedule: DriverRepaymentScheduleItem[]
}

function formatDateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleDateString("en-NG", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function renderStatusBadge(status: DriverRepaymentScheduleItem["status"]) {
  if (status === "PAID") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
        Paid
      </Badge>
    )
  }

  if (status === "LATE") {
    return (
      <Badge className="bg-red-600 text-white hover:bg-red-600">
        <AlertTriangle className="mr-1 h-3.5 w-3.5" />
        Late
      </Badge>
    )
  }

  if (status === "PARTIAL") {
    return (
      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
        <Clock3 className="mr-1 h-3.5 w-3.5" />
        Partial
      </Badge>
    )
  }

  return <Badge variant="secondary">Upcoming</Badge>
}

export function RepaymentScheduleTable({ schedule }: RepaymentScheduleTableProps) {
  if (schedule.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No repayment schedule is available for this contract.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-[10px] border border-border/70">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead>Week</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead>Expected</TableHead>
            <TableHead>Applied</TableHead>
            <TableHead>Remaining</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedule.map((item) => (
            <TableRow key={item.installmentNumber}>
              <TableCell className="font-medium">#{item.installmentNumber}</TableCell>
              <TableCell>{formatDateLabel(item.dueDate)}</TableCell>
              <TableCell>{formatNaira(item.expectedAmountNgn)}</TableCell>
              <TableCell>{formatNaira(item.paidAmountNgn)}</TableCell>
              <TableCell>{formatNaira(item.remainingAmountNgn)}</TableCell>
              <TableCell>{renderStatusBadge(item.status)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
