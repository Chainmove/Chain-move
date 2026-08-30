"use client"

import { useState, useEffect, useCallback } from "react"
import { RiskSummaryCards } from "@/components/admin/risk/RiskSummaryCards"
import { RiskFilterBar } from "@/components/admin/risk/RiskFilterBar"
import { RiskDataTable } from "@/components/admin/risk/RiskDataTable"
import { RiskDetailModal } from "@/components/admin/risk/RiskDetailModal"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"

export default function AdminRiskDashboard() {
  const [summary, setSummary] = useState<any>(null)
  const [isSummaryLoading, setIsSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [details, setDetails] = useState<any[]>([])
  const [isDetailsLoading, setIsDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  const [filters, setFilters] = useState({
    type: "late_repayments",
    status: "all",
    role: "all",
    dateRange: "",
  })

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const fetchSummary = async () => {
    try {
      setIsSummaryLoading(true)
      setSummaryError(null)
      const res = await fetch("/api/admin/risk/summary")
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error("Unauthorized access.")
        throw new Error("Failed to fetch risk summary.")
      }
      const data = await res.json()
      setSummary(data.summary)
    } catch (err: any) {
      setSummaryError(err.message || "An error occurred.")
    } finally {
      setIsSummaryLoading(false)
    }
  }

  const fetchDetails = useCallback(async () => {
    try {
      setIsDetailsLoading(true)
      setDetailsError(null)
      
      const queryParams = new URLSearchParams({
        type: filters.type,
        page: "1",
        limit: "50",
      })

      if (filters.status !== "all") queryParams.append("status", filters.status)
      if (filters.role !== "all") queryParams.append("role", filters.role)
      if (filters.dateRange) queryParams.append("dateRange", filters.dateRange)

      const res = await fetch(`/api/admin/risk/details?${queryParams.toString()}`)
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error("Unauthorized access.")
        throw new Error("Failed to fetch risk details.")
      }
      const data = await res.json()
      setDetails(data.data.records)
    } catch (err: any) {
      setDetailsError(err.message || "An error occurred.")
    } finally {
      setIsDetailsLoading(false)
    }
  }, [filters])

  // Fetch summary on mount
  useEffect(() => {
    fetchSummary()
  }, [])

  // Fetch details whenever filters change
  useEffect(() => {
    fetchDetails()
  }, [fetchDetails])

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const handleClearFilters = () => {
    setFilters({
      type: "late_repayments",
      status: "all",
      role: "all",
      dateRange: "",
    })
  }

  const handleRowClick = (record: any) => {
    setSelectedRecord(record)
    setIsModalOpen(true)
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Risk Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Monitor and take action on system-wide risk signals and flagged entities.
        </p>
      </div>

      {summaryError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error loading summary</AlertTitle>
          <AlertDescription>{summaryError}</AlertDescription>
        </Alert>
      )}

      <RiskSummaryCards summary={summary} isLoading={isSummaryLoading} />

      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Risk Details</h2>
        <RiskFilterBar 
          filters={filters} 
          onFilterChange={handleFilterChange} 
          onClearFilters={handleClearFilters} 
        />
        
        {detailsError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error loading details</AlertTitle>
            <AlertDescription>{detailsError}</AlertDescription>
          </Alert>
        ) : (
          <RiskDataTable 
            data={details} 
            isLoading={isDetailsLoading} 
            onRowClick={handleRowClick} 
          />
        )}
      </div>

      <RiskDetailModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        record={selectedRecord} 
      />
    </div>
  )
}
