"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Skeleton } from "@/components/ui/skeleton"
import { Search, Filter, Star, DollarSign, Car, Fuel, Eye, RefreshCw, AlertTriangle } from "lucide-react"
import Image from "next/image"

// Vehicles are shown as investment opportunities only when they are actively
// sourced from the authorized inventory API. Data older than this threshold
// is treated as stale and cannot be acted on until it is refreshed.
const STALE_AFTER_MS = 5 * 60 * 1000

interface VehicleSpecifications {
  fuelType?: string
  mileage?: string
}

interface Vehicle {
  _id: string
  name: string
  type: string
  year: number
  image?: string
  price: number
  roi: number
  status: "Available" | "Financed" | "Reserved" | "Maintenance" | "Retired"
  fundingStatus: "Open" | "Funded" | "Active"
  totalFundedAmount: number
  complianceStatus?: "compliant" | "warning" | "non_compliant" | "uninspected"
  driverId?: string
  specifications?: VehicleSpecifications
}

interface VehiclesResponse {
  success: boolean
  data?: Vehicle[]
  message?: string
}

function getComplianceBadge(complianceStatus: Vehicle["complianceStatus"]) {
  switch (complianceStatus) {
    case "compliant":
      return { label: "Compliant", className: "bg-green-600" }
    case "warning":
      return { label: "Warning", className: "bg-yellow-600" }
    case "non_compliant":
      return { label: "Non-Compliant", className: "bg-red-600" }
    default:
      return { label: "Uninspected", className: "bg-gray-600" }
  }
}

function getFundingProgress(vehicle: Vehicle) {
  if (!vehicle.price || vehicle.price <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((vehicle.totalFundedAmount / vehicle.price) * 100)))
}

export function DiscoverVehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedType, setSelectedType] = useState<string>("all")
  const [roiRange, setRoiRange] = useState([10, 20])
  const [showFilters, setShowFilters] = useState(false)

  const loadVehicles = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/vehicles")
      const body: VehiclesResponse = await response.json().catch(() => ({ success: false }))

      if (!response.ok || !body.success) {
        throw new Error(body.message || "Unable to load the live vehicle inventory.")
      }

      setVehicles(body.data ?? [])
      setLastFetchedAt(Date.now())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the live vehicle inventory.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadVehicles()
  }, [])

  // Keep the freshness check reactive so opportunities are marked stale as
  // soon as the threshold elapses, without requiring a manual refresh.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const isStale = lastFetchedAt !== null && now - lastFetchedAt > STALE_AFTER_MS

  // Delisted vehicles are no longer part of the inventory and must never
  // surface as an investable opportunity.
  const availableVehicles = vehicles.filter((vehicle) => vehicle.status !== "Retired")

  const vehicleTypes = Array.from(new Set(availableVehicles.map((vehicle) => vehicle.type))).sort()

  const filteredVehicles = availableVehicles.filter((vehicle) => {
    const matchesSearch = vehicle.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = selectedType === "all" || vehicle.type.toLowerCase() === selectedType.toLowerCase()
    const matchesROI = vehicle.roi >= roiRange[0] && vehicle.roi <= roiRange[1]

    return matchesSearch && matchesType && matchesROI
  })

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <Card className="bg-[#2a3441] border-gray-700">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="text-white">Discover Investment Opportunities</CardTitle>
              <CardDescription className="text-gray-400">Find vehicles to fund and earn returns</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadVehicles()}
              className="border-gray-600 text-gray-300 hover:bg-gray-700"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isStale && !isLoading && !error && (
              <div
                data-testid="stale-warning"
                className="flex items-center gap-2 rounded-lg border border-yellow-600/40 bg-yellow-600/10 p-3 text-sm text-yellow-400"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>This inventory is out of date. Refresh to fund a vehicle.</span>
              </div>
            )}

            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search vehicles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-[#1a2332] border-gray-600 text-white"
              />
            </div>

            {/* Filter Toggle */}
            <div className="flex justify-between items-center">
              <Button
                variant="outline"
                onClick={() => setShowFilters(!showFilters)}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
              </Button>
              <span className="text-sm text-gray-400">{filteredVehicles.length} vehicles found</span>
            </div>

            {/* Filters */}
            {showFilters && (
              <div className="grid md:grid-cols-3 gap-4 p-4 bg-[#1a2332] rounded-lg">
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Vehicle Type</label>
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger className="bg-[#2a3441] border-gray-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {vehicleTypes.map((type) => (
                        <SelectItem key={type} value={type.toLowerCase()}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm text-gray-400 mb-2 block">
                    ROI Range: {roiRange[0]}% - {roiRange[1]}%
                  </label>
                  <Slider value={roiRange} onValueChange={setRoiRange} max={25} min={5} step={0.5} className="mt-2" />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <div data-testid="vehicles-loading" className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="bg-[#2a3441] border-gray-700">
              <Skeleton className="h-48 w-full rounded-t-lg" />
              <CardContent className="space-y-3 pt-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error State */}
      {!isLoading && error && (
        <Card className="bg-[#2a3441] border-gray-700" data-testid="vehicles-error">
          <CardContent className="text-center py-12">
            <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">Unable to load vehicles</h3>
            <p className="text-gray-400 mb-4">{error}</p>
            <Button onClick={() => void loadVehicles()} className="bg-[#E57700] hover:bg-[#E57700]/90 text-white">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Vehicle Grid */}
      {!isLoading && !error && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVehicles.map((vehicle) => {
            const compliance = getComplianceBadge(vehicle.complianceStatus)
            const fundingProgress = getFundingProgress(vehicle)
            const isFundable = vehicle.fundingStatus === "Open" && vehicle.status === "Available" && !isStale

            return (
              <Card
                key={vehicle._id}
                className="bg-[#2a3441] border-gray-700 hover:border-[#E57700] transition-colors"
              >
                <div className="relative">
                  <Image
                    src={vehicle.image || "/placeholder.svg"}
                    alt={vehicle.name}
                    width={300}
                    height={200}
                    className="w-full h-48 object-cover rounded-t-lg"
                  />
                  <div className="absolute top-3 right-3 flex space-x-2">
                    <Badge className={`${compliance.className} text-white`}>{compliance.label}</Badge>
                    <Badge className="bg-[#E57700] text-white">{vehicle.roi}% ROI</Badge>
                  </div>
                </div>

                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg text-white">{vehicle.name}</CardTitle>
                      <CardDescription className="text-gray-400">
                        {vehicle.year} • {vehicle.type}
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-white">${vehicle.price.toLocaleString()}</p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="space-y-4">
                    {/* Driver & Status */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">{vehicle.driverId ? "Driver assigned" : "Unassigned"}</span>
                      <div className="flex items-center space-x-1">
                        <Star className="h-4 w-4 text-yellow-400 fill-current" />
                        <span className="text-white">{vehicle.status}</span>
                      </div>
                    </div>

                    {/* Vehicle Details */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {vehicle.specifications?.fuelType && (
                        <div className="flex items-center space-x-2 text-gray-400">
                          <Fuel className="h-4 w-4" />
                          <span>{vehicle.specifications.fuelType}</span>
                        </div>
                      )}
                      {vehicle.specifications?.mileage && (
                        <div className="flex items-center space-x-2 text-gray-400">
                          <Car className="h-4 w-4" />
                          <span>{vehicle.specifications.mileage}</span>
                        </div>
                      )}
                    </div>

                    {/* Funding Progress */}
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-400">Funding Progress</span>
                        <span className="text-sm text-white">{fundingProgress}%</span>
                      </div>
                      <div className="w-full bg-gray-600 rounded-full h-2">
                        <div
                          className="bg-[#E57700] h-2 rounded-full transition-all duration-300"
                          style={{ width: `${fundingProgress}%` }}
                        />
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex space-x-2">
                      <Button
                        disabled={!isFundable}
                        className="flex-1 bg-[#E57700] hover:bg-[#E57700]/90 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <DollarSign className="h-4 w-4 mr-2" />
                        {isFundable ? "Fund Vehicle" : "Not Available"}
                      </Button>
                      <Button variant="outline" size="sm" className="border-gray-600 text-gray-300 hover:bg-gray-700">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* No Results */}
      {!isLoading && !error && filteredVehicles.length === 0 && (
        <Card className="bg-[#2a3441] border-gray-700" data-testid="vehicles-empty">
          <CardContent className="text-center py-12">
            <Car className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">
              {availableVehicles.length === 0 ? "No vehicles available" : "No vehicles found"}
            </h3>
            <p className="text-gray-400 mb-4">
              {availableVehicles.length === 0
                ? "There are no vehicles in the live inventory right now."
                : "Try adjusting your search criteria or filters"}
            </p>
            {availableVehicles.length > 0 && (
              <Button
                onClick={() => {
                  setSearchTerm("")
                  setSelectedType("all")
                  setRoiRange([10, 20])
                }}
                className="bg-[#E57700] hover:bg-[#E57700]/90 text-white"
              >
                Clear Filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
