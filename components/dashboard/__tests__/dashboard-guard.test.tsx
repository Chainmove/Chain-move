import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockUseAuth, mockReplace } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockReplace: vi.fn(),
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: mockUseAuth,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
}))

import { DashboardGuard } from "@/components/dashboard/dashboard-guard"
import {
  getDashboardHomePath,
  getDashboardRoleConfig,
  isDashboardRole,
  resolveAllowedRoles,
} from "@/lib/dashboard/roles"

// ---------------------------------------------------------------------------
// Role config helpers
// ---------------------------------------------------------------------------

describe("dashboard role config", () => {
  it("recognizes known roles and rejects unknown ones", () => {
    expect(isDashboardRole("admin")).toBe(true)
    expect(isDashboardRole("driver")).toBe(true)
    expect(isDashboardRole("superuser")).toBe(false)
    expect(isDashboardRole(undefined)).toBe(false)
  })

  it("exposes a home path and quick actions per role", () => {
    expect(getDashboardRoleConfig("investor")?.homePath).toBe("/dashboard/investor")
    expect(getDashboardRoleConfig("driver")?.quickActions.length).toBeGreaterThan(0)
    expect(getDashboardRoleConfig("nope")).toBeNull()
  })

  it("falls back to the dashboard root for unknown roles", () => {
    expect(getDashboardHomePath("admin")).toBe("/dashboard/admin")
    expect(getDashboardHomePath("ghost")).toBe("/dashboard")
  })

  it("normalizes a single role or a list into an array", () => {
    expect(resolveAllowedRoles("admin")).toEqual(["admin"])
    expect(resolveAllowedRoles(["admin", "driver"])).toEqual(["admin", "driver"])
  })
})

// ---------------------------------------------------------------------------
// DashboardGuard
// ---------------------------------------------------------------------------

describe("DashboardGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows the loading state while auth is resolving", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true })

    render(
      <DashboardGuard allow="admin" loadingTitle="Loading admin dashboard">
        <p>secret</p>
      </DashboardGuard>,
    )

    expect(screen.getByText("Loading admin dashboard")).toBeInTheDocument()
    expect(screen.queryByText("secret")).not.toBeInTheDocument()
  })

  it("redirects unauthenticated users to sign in", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false })

    render(
      <DashboardGuard allow="admin">
        <p>secret</p>
      </DashboardGuard>,
    )

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/signin"))
    expect(screen.queryByText("secret")).not.toBeInTheDocument()
  })

  it("renders an access-denied state for the wrong role", () => {
    mockUseAuth.mockReturnValue({ user: { id: "1", role: "driver" }, loading: false })

    render(
      <DashboardGuard allow="admin">
        <p>secret</p>
      </DashboardGuard>,
    )

    expect(screen.getByText("Access denied")).toBeInTheDocument()
    expect(screen.queryByText("secret")).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("renders children for an authorized role", () => {
    mockUseAuth.mockReturnValue({ user: { id: "1", role: "admin" }, loading: false })

    render(
      <DashboardGuard allow={["admin", "investor"]}>
        <p>secret</p>
      </DashboardGuard>,
    )

    expect(screen.getByText("secret")).toBeInTheDocument()
  })
})
