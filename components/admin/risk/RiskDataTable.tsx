import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

interface RiskDataTableProps {
  data: any[]
  isLoading?: boolean
  onRowClick: (record: any) => void
}

export function RiskDataTable({ data, isLoading, onRowClick }: RiskDataTableProps) {
  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground animate-pulse border rounded-lg bg-background">
        Loading records...
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground border rounded-lg bg-background">
        No risk records found matching the current criteria.
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-background overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Risk Signal</TableHead>
            <TableHead>Admin Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((record, index) => {
            // Flexible property resolution based on the record type
            const user = record.driverUserId || record.userId || {}
            const entityName = user.name || user.email || record._id?.name || record._id?.email || "Unknown User/Entity"
            
            // Generate a simple signal description
            let riskSignal = "Flagged Activity"
            if (record.amount !== undefined) riskSignal = `Amount: ${record.amount}`
            if (record.failedCount !== undefined) riskSignal = `${record.failedCount} Failed TXNs`
            if (record.performanceRatio !== undefined) riskSignal = `Ratio: ${(record.performanceRatio * 100).toFixed(1)}%`
            if (record.nextDueDate !== undefined) riskSignal = `Due: ${new Date(record.nextDueDate).toLocaleDateString()}`

            // Date processing
            const recordDate = record.createdAt || record.timestamp || record.latestFailure || record.updatedAt
            const dateStr = recordDate ? new Date(recordDate).toLocaleDateString() : "N/A"

            // Fake review status badge logic for demonstration
            const reviewStatus = record.adminReviewStatus || "Pending Review"
            const isPending = reviewStatus === "Pending Review" || reviewStatus === "Pending"
            
            return (
              <TableRow 
                key={record._id || index} 
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => onRowClick(record)}
              >
                <TableCell className="font-medium">{dateStr}</TableCell>
                <TableCell>{entityName}</TableCell>
                <TableCell>{riskSignal}</TableCell>
                <TableCell>
                  <Badge 
                    variant={isPending ? "outline" : "default"} 
                    className={isPending ? "text-amber-500 border-amber-500" : "bg-green-500"}
                  >
                    {reviewStatus}
                  </Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
