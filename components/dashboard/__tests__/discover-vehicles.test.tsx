import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DiscoverVehicles } from "@/components/dashboard/discover-vehicles"

function buildVehicle(overrides: Record<string, unknown> = {}) {
  return {
    _id: "vehicle-1",
    name: "Toyota Hiace Mini Bus 2023",
    type: "Mini Bus",
    year: 2023,
    price: 35000,
    roi: 18.5,
    status: "Available",
    fundingStatus: "Open",
    totalFundedAmount: 17500,
    complianceStatus: "compliant",
    ...overrides,
  }
}

function mockFetchSuccess(data: unknown[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data }),
  })
}

function mockFetchFailure(message: string, status = 500) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ success: false, message }),
  })
}

describe("DiscoverVehicles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error clearing global fetch between tests
    global.fetch = undefined
  })

  it("fetches vehicles from the live inventory API rather than a fixture", async () => {
    mockFetchSuccess([buildVehicle()])

    render(<DiscoverVehicles />)

    await waitFor(() => {
      expect(screen.getByText("Toyota Hiace Mini Bus 2023")).toBeInTheDocument()
    })

    expect(global.fetch).toHaveBeenCalledWith("/api/vehicles")
  })

  it("shows a loading state while the request is in flight", () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}))

    render(<DiscoverVehicles />)

    expect(screen.getByTestId("vehicles-loading")).toBeInTheDocument()
  })

  it("shows an empty inventory state when the API returns no vehicles", async () => {
    mockFetchSuccess([])

    render(<DiscoverVehicles />)

    await waitFor(() => {
      expect(screen.getByTestId("vehicles-empty")).toBeInTheDocument()
    })

    expect(screen.getByText(/No vehicles available/i)).toBeInTheDocument()
  })

  it("shows an error state with retry when the API request fails", async () => {
    mockFetchFailure("Server Error")

    render(<DiscoverVehicles />)

    await waitFor(() => {
      expect(screen.getByTestId("vehicles-error")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument()
  })

  it("shows an error state when fetch itself throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"))

    render(<DiscoverVehicles />)

    await waitFor(() => {
      expect(screen.getByTestId("vehicles-error")).toBeInTheDocument()
    })

    expect(screen.getByText(/Network failure/i)).toBeInTheDocument()
  })

  it("excludes delisted (retired) vehicles from the opportunities list", async () => {
    mockFetchSuccess([
      buildVehicle({ _id: "v-active", name: "Active Vehicle" }),
      buildVehicle({ _id: "v-retired", name: "Retired Vehicle", status: "Retired" }),
    ])

    render(<DiscoverVehicles />)

    await waitFor(() => {
      expect(screen.getByText("Active Vehicle")).toBeInTheDocument()
    })

    expect(screen.queryByText("Retired Vehicle")).not.toBeInTheDocument()
  })

  it("disables funding on a vehicle that is already fully funded", async () => {
    mockFetchSuccess([
      buildVehicle({ name: "Funded Vehicle", fundingStatus: "Funded", totalFundedAmount: 35000 }),
    ])

    render(<DiscoverVehicles />)

    await waitFor(() => {
      expect(screen.getByText("Funded Vehicle")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: /Not Available/i })).toBeDisabled()
  })

  it("renders vehicles with partial/missing optional fields without crashing", async () => {
    mockFetchSuccess([
      buildVehicle({
        name: "Partial Vehicle",
        image: undefined,
        complianceStatus: undefined,
        specifications: undefined,
        driverId: undefined,
      }),
    ])

    render(<DiscoverVehicles />)

    await waitFor(() => {
      expect(screen.getByText("Partial Vehicle")).toBeInTheDocument()
    })

    expect(screen.getByText("Uninspected")).toBeInTheDocument()
    expect(screen.getByText("Unassigned")).toBeInTheDocument()
  })
})
