import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockUseAuth, mockToast } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockToast: vi.fn(),
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: mockUseAuth,
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}))

import { StellarLinkForm } from "@/components/dashboard/stellar-link-form"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_KEY = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"

function buildAuthUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "Test User",
    role: "investor",
    stellarPublicKey: null,
    ...overrides,
  }
}

function mockFetchSuccess(stellarPublicKey = VALID_KEY) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ user: { stellarPublicKey } }),
  })
}

function mockFetchError(status: number, message: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ message }),
  })
}

function typeIntoInput(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StellarLinkForm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error clearing global fetch between tests
    global.fetch = undefined
    mockUseAuth.mockReturnValue({
      user: buildAuthUser(),
      refetch: vi.fn(),
    })
  })

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  it("shows the empty state when no Stellar account is linked", () => {
    render(<StellarLinkForm />)

    expect(screen.getByTestId("empty-state")).toBeInTheDocument()
    expect(screen.getByText(/No Stellar account linked yet/i)).toBeInTheDocument()
  })

  it("renders the link button and input in empty state", () => {
    render(<StellarLinkForm />)

    expect(screen.getByTestId("stellar-key-input")).toBeInTheDocument()
    expect(screen.getByTestId("submit-button")).toHaveTextContent(/Link account/i)
  })

  it("shows the public-key-only warning alert", () => {
    render(<StellarLinkForm />)

    expect(screen.getAllByText(/Only enter your/i).length).toBeGreaterThanOrEqual(1)
  })

  // -------------------------------------------------------------------------
  // Existing linked account display
  // -------------------------------------------------------------------------

  it("shows the existing linked account when stellarPublicKey is set on the user", () => {
    mockUseAuth.mockReturnValue({
      user: buildAuthUser({ stellarPublicKey: VALID_KEY }),
      refetch: vi.fn(),
    })

    render(<StellarLinkForm />)

    expect(screen.getByTestId("linked-account-display")).toBeInTheDocument()
    expect(screen.getByText(VALID_KEY)).toBeInTheDocument()
    expect(screen.getAllByText(/Linked/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument()
  })

  it("shows 'Update account' button text when an account is already linked", () => {
    mockUseAuth.mockReturnValue({
      user: buildAuthUser({ stellarPublicKey: VALID_KEY }),
      refetch: vi.fn(),
    })

    render(<StellarLinkForm />)

    expect(screen.getByTestId("submit-button")).toHaveTextContent(/Update account/i)
  })

  // -------------------------------------------------------------------------
  // Invalid input validation
  // -------------------------------------------------------------------------

  it("shows a field error when the form is submitted with an empty input", async () => {
    render(<StellarLinkForm />)

    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    expect(screen.getByTestId("field-error")).toHaveTextContent(/Stellar public account is required/i)
  })

  it("shows a field error for an invalid key format (too short)", async () => {
    render(<StellarLinkForm />)

    typeIntoInput(screen.getByTestId("stellar-key-input"), "GINVALIDKEY")
    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    expect(screen.getByTestId("field-error")).toHaveTextContent(/valid Stellar public account/i)
  })

  it("shows a field error for a key that does not start with G", async () => {
    render(<StellarLinkForm />)

    const badKey = "XBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"
    typeIntoInput(screen.getByTestId("stellar-key-input"), badKey)
    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    expect(screen.getByTestId("field-error")).toBeInTheDocument()
  })

  it("clears the field error when the user starts typing again", async () => {
    render(<StellarLinkForm />)

    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))
    expect(screen.getByTestId("field-error")).toBeInTheDocument()

    typeIntoInput(screen.getByTestId("stellar-key-input"), "G")
    expect(screen.queryByTestId("field-error")).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Successful link
  // -------------------------------------------------------------------------

  it("calls the API and shows success state after a valid key is submitted", async () => {
    mockFetchSuccess(VALID_KEY)
    const refetch = vi.fn()
    mockUseAuth.mockReturnValue({ user: buildAuthUser(), refetch })

    render(<StellarLinkForm />)

    typeIntoInput(screen.getByTestId("stellar-key-input"), VALID_KEY)
    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    await waitFor(() => {
      expect(screen.getByTestId("linked-account-display")).toBeInTheDocument()
    })

    expect(screen.getByText(VALID_KEY)).toBeInTheDocument()
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Stellar account linked" }),
    )
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("calls the onLinked callback with the linked key on success", async () => {
    mockFetchSuccess(VALID_KEY)
    const onLinked = vi.fn()

    render(<StellarLinkForm onLinked={onLinked} />)

    typeIntoInput(screen.getByTestId("stellar-key-input"), VALID_KEY)
    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    await waitFor(() => {
      expect(onLinked).toHaveBeenCalledWith(VALID_KEY)
    })
  })

  it("clears the input field after a successful link", async () => {
    mockFetchSuccess(VALID_KEY)

    render(<StellarLinkForm />)

    const input = screen.getByTestId("stellar-key-input") as HTMLInputElement
    typeIntoInput(input, VALID_KEY)
    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    await waitFor(() => {
      expect(input.value).toBe("")
    })
  })

  // -------------------------------------------------------------------------
  // Error states
  // -------------------------------------------------------------------------

  it("shows an API error message when the server returns 409", async () => {
    mockFetchError(409, "This Stellar account is already linked to another user.")

    render(<StellarLinkForm />)

    typeIntoInput(screen.getByTestId("stellar-key-input"), VALID_KEY)
    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    await waitFor(() => {
      expect(screen.getByTestId("api-error")).toHaveTextContent(/already linked to another user/i)
    })
  })

  it("shows an API error message when the server returns 400", async () => {
    mockFetchError(400, "Invalid Stellar public account.")

    render(<StellarLinkForm />)

    typeIntoInput(screen.getByTestId("stellar-key-input"), VALID_KEY)
    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    await waitFor(() => {
      expect(screen.getByTestId("api-error")).toBeInTheDocument()
    })
  })

  it("shows a network error message when fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"))

    render(<StellarLinkForm />)

    typeIntoInput(screen.getByTestId("stellar-key-input"), VALID_KEY)
    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    await waitFor(() => {
      expect(screen.getByTestId("api-error")).toHaveTextContent(/network error/i)
    })
  })

  it("clears the API error when the user starts typing a new value", async () => {
    mockFetchError(409, "Already linked.")

    render(<StellarLinkForm />)

    typeIntoInput(screen.getByTestId("stellar-key-input"), VALID_KEY)
    fireEvent.submit(screen.getByTestId("stellar-link-form-element"))

    await waitFor(() => {
      expect(screen.getByTestId("api-error")).toBeInTheDocument()
    })

    typeIntoInput(screen.getByTestId("stellar-key-input"), "G")
    expect(screen.queryByTestId("api-error")).not.toBeInTheDocument()
  })
})
