"use client"

import { useEffect, type ReactElement } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle, Clock, Loader2 } from "lucide-react"

import { Header } from "@/components/dashboard/header"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"

export default function InvestorKycStatusPage() {
  const router = useRouter()
  const { user: authUser, loading: authLoading } = useAuth()

  useEffect(() => {
    if (authLoading) return
    if (!authUser || authUser.role !== "investor") {
      router.replace("/signin")
      return
    }

    const status = authUser.kycStatus || "none"
    if (status === "none" || status === "rejected") {
      router.replace("/dashboard/investor/kyc")
    }
  }, [authLoading, authUser, router])

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading investor KYC status...</p>
        </div>
      </div>
    )
  }

  if (!authUser || authUser.role !== "investor" || authUser.kycStatus === "none" || authUser.kycStatus === "rejected") {
    return null
  }

  const status = authUser.kycStatus || "none"

  let icon = <Loader2 className="mx-auto mb-4 h-14 w-14 animate-spin text-muted-foreground" />
  let title = "Checking KYC status..."
  let description = "Please wait while we load your investor verification status."
  let action: ReactElement | null = null

  if (status === "pending") {
    icon = <Clock className="mx-auto mb-4 h-14 w-14 text-yellow-500" />
    title = "KYC under review"
    description = "Your investor KYC documents are being reviewed by the operations team."
  } else if (status === "approved_stage2" || status === "approved_stage1" || authUser.isKycVerified || authUser.kycVerified) {
    icon = <CheckCircle className="mx-auto mb-4 h-14 w-14 text-emerald-500" />
    title = "KYC approved"
    description = "Your investor verification has been approved. You can continue with funding and investments."
    action = (
      <Button
        onClick={() => router.push("/dashboard/investor")}
        className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
      >
        Go to dashboard
      </Button>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        role="investor"
        mobileWidth="w-[calc(100vw-1rem)] max-w-[212px]"
        className="md:w-[212px] lg:w-[212px]"
      />

      <div className="min-w-0 md:ml-[212px]">
        <Header userStatus="Verified Investor" showBackButton />

        <main className="min-w-0 p-4 md:p-6">
          <Card className="mx-auto max-w-2xl border-border/70 text-center">
            <CardHeader>
              {icon}
              <CardTitle className="text-2xl">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            {action ? <CardContent>{action}</CardContent> : null}
          </Card>
        </main>
      </div>
    </div>
  )
}
