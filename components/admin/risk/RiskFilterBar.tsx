import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"

interface RiskFilterBarProps {
  filters: {
    type: string
    status: string
    role: string
    dateRange: string
  }
  onFilterChange: (key: string, value: string) => void
  onClearFilters: () => void
}

export function RiskFilterBar({ filters, onFilterChange, onClearFilters }: RiskFilterBarProps) {
  return (
    <div className="flex flex-col md:flex-row items-center gap-4 bg-background p-4 rounded-lg border">
      <div className="w-full md:w-auto flex-1">
        <Select value={filters.type} onValueChange={(val) => onFilterChange("type", val)}>
          <SelectTrigger>
            <SelectValue placeholder="Risk Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="late_repayments">Late Repayments</SelectItem>
            <SelectItem value="repeated_failed_transactions">Repeated Failed TXNs</SelectItem>
            <SelectItem value="inactive_contracts">Inactive Contracts</SelectItem>
            <SelectItem value="underperforming_pools">Underperforming Pools</SelectItem>
            <SelectItem value="high_value_wallet_funding">High-Value Funding</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-full md:w-auto flex-1">
        <Select value={filters.status} onValueChange={(val) => onFilterChange("status", val)}>
          <SelectTrigger>
            <SelectValue placeholder="Review Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending Review</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-full md:w-auto flex-1">
        <Select value={filters.role} onValueChange={(val) => onFilterChange("role", val)}>
          <SelectTrigger>
            <SelectValue placeholder="User Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="driver">Driver</SelectItem>
            <SelectItem value="investor">Investor</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-full md:w-auto flex-1">
        <Input 
          type="date" 
          value={filters.dateRange} 
          onChange={(e) => onFilterChange("dateRange", e.target.value)}
          placeholder="Filter by Date"
        />
      </div>

      <div className="w-full md:w-auto">
        <Button variant="outline" onClick={onClearFilters}>
          Clear Filters
        </Button>
      </div>
    </div>
  )
}
