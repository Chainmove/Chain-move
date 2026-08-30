import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StellarActivityPanel } from "@/components/dashboard/investor-overview/stellar-activity-panel"
import { buildStellarReferenceUrl } from "@/lib/stellar/display-config"

describe("StellarActivityPanel", () => {
  it("shows the empty state when no Stellar account is linked", () => {
    const view = render(<StellarActivityPanel data={null} isLoading={false} error={null} />)

    expect(view.getByText(/No Stellar account is linked yet/i)).toBeInTheDocument()
  })

  it("shows the loading state", () => {
    const view = render(<StellarActivityPanel data={null} isLoading={true} error={null} />)

    expect(view.getByText(/Stellar activity/i)).toBeInTheDocument()
    expect(view.getByText(/Linked testnet account activity/i)).toBeInTheDocument()
  })

  it("renders populated activity rows and reference links", () => {
    const referenceUrl = buildStellarReferenceUrl("abcdef1234567890")

    const view = render(
      <StellarActivityPanel
        isLoading={false}
        error={null}
        data={{
          linkedAccount: "GBTESTLINKEDACCOUNT000000000000000000000000000000000000000000",
          activities: [
            {
              id: "stellar-activity-1",
              type: "Repayment settlement",
              amount: "120.00",
              asset: "XLM",
              date: "2026-06-12T09:30:00Z",
              status: "Confirmed",
              reference: referenceUrl,
            },
          ],
        }}
      />,
    )

    expect(view.getByText(/Linked Stellar public account/i)).toBeInTheDocument()
    expect(view.getAllByText(/Repayment settlement/i)).toHaveLength(2)
    expect(view.getAllByText(/120\.00 XLM/i)).toHaveLength(2)
    expect(view.getAllByText(/Jun 12, 2026/i)).toHaveLength(2)
    expect(view.getByRole("link", { name: /View reference/i })).toHaveAttribute("href", referenceUrl ?? "")
  })

  it("shows an error state with retry action", () => {
    const view = render(
      <StellarActivityPanel data={null} isLoading={false} error="Something went wrong" onRetry={() => undefined} />,
    )

    expect(view.getByText(/Unable to load Stellar activity/i)).toBeInTheDocument()
    expect(view.getByText(/Something went wrong/i)).toBeInTheDocument()
    expect(view.getByRole("button", { name: /Retry/i })).toBeInTheDocument()
  })
})
