"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle, Clock, XCircle, Bell, Calendar } from "lucide-react" // Added Calendar icon
import { useAuth } from "@/hooks/use-auth"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"

export default function KycStatusPage() {
  const { user: authUser, loading: authLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && (!authUser || authUser.role !== "driver")) {
      router.replace("/signin") // Redirect if not logged in or not a driver
    }
    // If KYC status is 'none', redirect to the KYC submission page
    if (!authLoading && authUser && (authUser as any).kycStatus === "none") {
      router.replace("/dashboard/driver/kyc")
    }
  }, [authUser, authLoading, router])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Loading...</h2>
          <p className="text-muted-foreground">Please wait while we fetch your account information.</p>
        </div>
      </div>
    )
  }

  // If authUser is null or not a driver, or kycStatus is 'none',
  // the useEffect will handle the redirection. We return null to prevent rendering
  // until the redirect happens.
  if (!authUser || authUser.role !== "driver" || (authUser as any).kycStatus === "none") {
    return null
  }

  const kycStatus = (authUser as any)?.kycStatus || "none"
  const physicalMeetingStatus = (authUser as any)?.physicalMeetingStatus || "none"
  const physicalMeetingDate = (authUser as any)?.physicalMeetingDate
    ? new Date((authUser as any).physicalMeetingDate).toLocaleDateString()
    : "N/A"

  let statusIcon
  let statusTitle
  let statusMessage
  let actionButton = null

  if (physicalMeetingStatus === "rejected_stage2") {
    statusIcon = <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
    statusTitle = "KYC Stage 2 Rejected"
    statusMessage =
      "Unfortunately, your second stage KYC (physical meeting) was rejected. Please review your notifications for next steps."
    if ((authUser as any)?.kycRejectionReason) {
      statusMessage += ` Reason: ${(authUser as any).kycRejectionReason}`
    }
    actionButton = (
      <Button
        variant="outline"
        onClick={() => router.push("/dashboard/driver/notifications")}
        className="border-border text-foreground hover:bg-muted bg-transparent"
      >
        <Bell className="mr-2 h-4 w-4" />
        Review Alerts
      </Button>
    )
  } else {
    switch (kycStatus) {
    case "pending":
      statusIcon = <Clock className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
      statusTitle = "KYC Under Review (Stage 1)"
      statusMessage =
        "Your first stage Know Your Customer (KYC) documents have been received and are currently being reviewed. We will notify you once the verification process is complete."
      break
    case "approved_stage1":
      // Handle different physical meeting statuses for approved_stage1
      if (physicalMeetingStatus === "scheduled") {
        statusIcon = <Clock className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
        statusTitle = "Physical Meeting Scheduled"
        statusMessage = `Your physical meeting for KYC Stage 2 is scheduled for ${physicalMeetingDate}. It is currently awaiting admin approval.`
        // actionButton = (
        //   <Button
        //     onClick={() => router.push("/dashboard/driver/kyc")}
        //     className="bg-[#E57700] hover:bg-[#E57700]/90 text-white"
        //   >
        //     View Meeting Details
        //   </Button>
        // )
      } else if (physicalMeetingStatus === "approved") {
        statusIcon = <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        statusTitle = "Physical Meeting Date Approved!"
        statusMessage = `Your physical meeting for KYC Stage 2 on ${physicalMeetingDate} has been approved by the admin. Please prepare for the inspection.`
        actionButton = (
          <Button
            onClick={() => router.push("/dashboard/driver")}
            className="bg-[#E57700] hover:bg-[#E57700]/90 text-white"
          >
            Go to Dashboard
          </Button>
        )
      } else if (physicalMeetingStatus === "rescheduled") {
        statusIcon = <Calendar className="h-16 w-16 text-blue-500 mx-auto mb-4" />
        statusTitle = "Physical Meeting Rescheduled"
        statusMessage = `Your physical meeting for KYC Stage 2 has been rescheduled to ${physicalMeetingDate}. Please check your notifications for details.`
        actionButton = (
          <Button
            onClick={() => router.push("/dashboard/driver/notifications")}
            className="bg-[#E57700] hover:bg-[#E57700]/90 text-white"
          >
            View Notifications
          </Button>
        )
      } else {
        // Default for approved_stage1 if physicalMeetingStatus is 'none' or unexpected
        statusIcon = <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        statusTitle = "KYC Stage 1 Approved!"
        statusMessage =
          "Congratulations! Your first stage KYC verification has been successfully approved. Please proceed to schedule your physical meeting for the second stage of verification."
        actionButton = (
          <Button
            onClick={() => router.push("/dashboard/driver/kyc")}
            className="bg-[#E57700] hover:bg-[#E57700]/90 text-white"
          >
            Proceed with Second KYC
          </Button>
        )
      }
      break
    case "pending_stage2":
      // This status implies the physical meeting is either scheduled, approved, or rescheduled and awaiting completion
      if (physicalMeetingStatus === "scheduled") {
        statusIcon = <Clock className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
        statusTitle = "KYC Under Review (Stage 2)"
        statusMessage = `Your physical meeting for second stage KYC is scheduled for ${physicalMeetingDate}. It is currently under review by the admin.`
      } else if (physicalMeetingStatus === "approved") {
        statusIcon = <Clock className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
        statusTitle = "KYC Under Review (Stage 2)"
        statusMessage = `Your physical meeting for second stage KYC on ${physicalMeetingDate} has been approved and is awaiting completion by the admin.`
      } else if (physicalMeetingStatus === "rescheduled") {
        statusIcon = <Clock className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
        statusTitle = "KYC Under Review (Stage 2)"
        statusMessage = `Your physical meeting for second stage KYC has been rescheduled to ${physicalMeetingDate} and is awaiting completion by the admin.`
      } else {
        statusIcon = <Clock className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
        statusTitle = "KYC Under Review (Stage 2)"
        statusMessage = `Your second stage KYC is currently under review. We will notify you once the verification is complete.`
      }
      break
    case "approved_stage2":
      statusIcon = <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
      statusTitle = "KYC Fully Approved!"
      statusMessage =
        "Congratulations! Your KYC verification has been successfully approved. You can now fully access all features, including applying for vehicle loans."
      actionButton = (
        <Button
          onClick={() => router.push("/dashboard/driver")}
          className="bg-[#E57700] hover:bg-[#E57700]/90 text-white"
        >
          Go to Dashboard
        </Button>
      )
      break
    case "rejected":
      statusIcon = <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
      statusTitle = "KYC Rejected"
      statusMessage =
        "Unfortunately, your KYC verification was rejected. This could be due to incomplete information, unreadable documents, or other reasons. Please review the requirements and re-submit your documents."
      if ((authUser as any)?.kycRejectionReason) {
        statusMessage += ` Reason: ${(authUser as any).kycRejectionReason}`
      }
      actionButton = (
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            onClick={() => router.push("/dashboard/driver/kyc")}
            className="bg-[#E57700] hover:bg-[#E57700]/90 text-white"
          >
            Re-submit KYC
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push("/dashboard/driver/notifications")}
            className="border-border text-foreground hover:bg-muted bg-transparent"
          >
            <Bell className="mr-2 h-4 w-4" />
            Review Alerts
          </Button>
        </div>
      )
      break
    case "rejected_stage2":
      statusIcon = <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
      statusTitle = "KYC Stage 2 Rejected"
      statusMessage =
        "Unfortunately, your second stage KYC (physical meeting) was rejected. Please review your notifications for next steps."
      if ((authUser as any)?.kycRejectionReason) {
        statusMessage += ` Reason: ${(authUser as any).kycRejectionReason}`
      }
      actionButton = (
        <Button
          variant="outline"
          onClick={() => router.push("/dashboard/driver/notifications")}
          className="border-border text-foreground hover:bg-muted bg-transparent"
        >
          <Bell className="mr-2 h-4 w-4" />
          Review Alerts
        </Button>
      )
      break
    default:
      statusIcon = <Loader2 className="h-16 w-16 animate-spin text-muted-foreground mx-auto mb-4" />
      statusTitle = "Checking KYC Status..."
      statusMessage = "Please wait while we determine your KYC verification status."
      break
    }
  }

  return (
    <>
      <div className="min-h-screen bg-background">
        <Sidebar role="driver" />
        <div className="md:ml-64 lg:ml-72">
          <Header
            userName={authUser.name || "Driver"}
            userStatus="Driver"
            className="md:pl-6 lg:pl-8"
          />
          <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 md:space-y-8 max-w-full overflow-x-hidden">
            <Card className="max-w-2xl mx-auto text-center">
              <CardHeader>
                {statusIcon}
                <CardTitle className="text-2xl font-bold">{statusTitle}</CardTitle>
                <CardDescription>{statusMessage}</CardDescription>
              </CardHeader>
              <CardContent>{actionButton}</CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
