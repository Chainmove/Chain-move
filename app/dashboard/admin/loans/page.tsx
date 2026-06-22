"use client"

import React, { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, CheckCircle, XCircle, FileText, User, Car, DollarSign, Calendar, Clock, Eye } from "lucide-react"
import { usePlatform } from "@/contexts/platform-context"
import { useToast } from "@/hooks/use-toast"
import Image from "next/image"

export default function AdminLoanManagementPage() {
  const { state, dispatch } = usePlatform()
  const { toast } = useToast()
  
  // State for loan management
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("pending")
  const [selectedLoan, setSelectedLoan] = useState<any>(null)
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
  const [isActionDialogOpen, setIsActionDialogOpen] = useState(false)
  const [actionType, setActionType] = useState<any>(null)
  const [adminNotes, setAdminNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loans, setLoans] = useState<any[]>([])

  // Fetch loans from database
  const fetchLoans = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/loans')
      if (response.ok) {
        const { loans: fetchedLoans } = await response.json()
        setLoans(fetchedLoans)
        // Update the platform context for consistency - keep populated objects
        dispatch({
          type: "SET_LOAN_APPLICATIONS",
          payload: fetchedLoans.map((loan: any) => ({
            ...loan,
            id: loan._id,
            // Keep the populated objects intact:
            driverId: loan.driverId,
            vehicleId: loan.vehicleId
          }))
        })
      }
    } catch (error) {
      console.error('Error fetching loans:', error)
      toast({
        title: "Error",
        description: "Failed to fetch loan applications",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchLoans()
  }, [])

  // Filter loans based on active tab
  const filteredLoans = loans?.filter(loan => {
    if (activeTab === "pending") return loan.status === "Pending"
    if (activeTab === "approved") return loan.status === "Approved"
    if (activeTab === "rejected") return loan.status === "Rejected"
    if (activeTab === "active") return loan.status === "Active"
    return true // All loans
  }) || []

  // Handle opening the loan details dialog
  const handleViewDetails = (loan: any) => {
    setSelectedLoan(loan)
    setIsDetailsDialogOpen(true)
  }

  // Handle opening the action dialog (approve/reject)
  const handleAction = (loan: any, type: any) => {
    setSelectedLoan(loan)
    setActionType(type)
    setAdminNotes("")
    setIsActionDialogOpen(true)
  }

  // Handle confirming the action (approve/reject)
  const handleConfirmAction = async () => {
    if (!selectedLoan || !actionType) return

    setIsSubmitting(true)
    try {
      // Update loan status via API
      const response = await fetch('/api/loans', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          loanId: selectedLoan._id,
          status: actionType === "approve" ? "Approved" : "Rejected",
          adminNotes: adminNotes.trim() || undefined,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update loan status')
      }

      // Refresh loans data
      await fetchLoans()

      // Fix: Get driver info from the populated loan object
      const driverInfo = selectedLoan.driverId
      
      if (driverInfo && (driverInfo.email || driverInfo._id)) {
        // Add notification for the driver
        const notificationTitle = actionType === "approve" 
          ? "Loan Application Approved" 
          : "Loan Application Rejected"
        
        const notificationMessage = actionType === "approve"
          ? `Your loan application for $${selectedLoan.requestedAmount.toLocaleString()} has been approved.`
          : `Your loan application for $${selectedLoan.requestedAmount.toLocaleString()} has been rejected. ${adminNotes ? `Reason: ${adminNotes}` : ''}`
        
        // Get the correct user ID
        const userId = driverInfo._id || driverInfo.id
        
        // Dispatch notification to context
        dispatch({
          type: "ADD_NOTIFICATION",
          payload: {
            userId: userId,
            title: notificationTitle,
            message: notificationMessage,
            type: actionType === "approve" ? "success" : "error",
            priority: "high",
            actionUrl: "/dashboard/driver/loan-terms"
          },
        } as any)
        
        // Persist notification to database
        try {
          await fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: userId,
              title: notificationTitle,
              message: notificationMessage,
              type: actionType === "approve" ? "loan_approved" : "loan_rejected",
              priority: "high",
              actionUrl: "/dashboard/driver/loan-terms"
            })
          })
        } catch (notifError) {
          console.error('Error saving notification:', notifError)
        }
      
      // Send email notification
      if (driverInfo.email) {
        await sendEmailNotification(driverInfo.email, notificationTitle, notificationMessage)
      } else {
        console.error('Driver email not found:', driverInfo)
      }
    } else {
      console.error('Driver information not found in loan:', selectedLoan)
    }

    // Update vehicle status if approved
    if (actionType === "approve") {
      const vehicleInfo = selectedLoan.vehicleId
      if (vehicleInfo && vehicleInfo._id) {
        dispatch({
          type: "UPDATE_VEHICLE",
          payload: {
            id: vehicleInfo._id,
            updates: { status: "Financed" },
          },
        })
      }
    }

    toast({
      title: actionType === "approve" ? "Loan Approved" : "Loan Rejected",
      description: `The loan application has been ${actionType === "approve" ? "approved" : "rejected"}.`,
    })

    setIsActionDialogOpen(false)
  } catch (error) {
    console.error("Error processing loan action:", error)
    toast({
      title: "Action Failed",
      description: "There was an error processing your request.",
      variant: "destructive",
    })
  } finally {
    setIsSubmitting(false)
  }
}

  // Send email notification
  const sendEmailNotification = async (email: any, subject: any, message: any) => {
    try {
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
          <h2 style="color: #E57700; margin-bottom: 20px;">${subject}</h2>
          <p style="margin-bottom: 15px;">${message}</p>
          <p style="margin-bottom: 15px;">Please log in to your dashboard to view more details.</p>
          <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
            <p style="font-size: 12px; color: #666;">This is an automated message from Chain Move. Please do not reply to this email.</p>
          </div>
        </div>
      `

      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: email,
          subject: subject,
          html: htmlContent,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to send email')
      }
    } catch (error) {
      console.error('Error sending email:', error)
      // Continue with the process even if email fails
    }
  }

  // Render loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Loading Loan Applications...</h2>
          <p className="text-muted-foreground">Please wait while we fetch the data.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Loan Management</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Review and manage loan applications from drivers
          </p>
        </div>
      </div>

      {/* Tabs for filtering loans */}
      <Tabs defaultValue="pending" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-5 w-full max-w-3xl">
          <TabsTrigger value="pending" className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white">
            Pending
          </TabsTrigger>
          <TabsTrigger value="approved" className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white">
            Approved
          </TabsTrigger>
          <TabsTrigger value="rejected" className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white">
            Rejected
          </TabsTrigger>
          <TabsTrigger value="active" className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white">
            Active
          </TabsTrigger>
          <TabsTrigger value="all" className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white">
            All
          </TabsTrigger>
        </TabsList>

        {/* Tab Content */}
        <TabsContent value={activeTab} className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center">
                <FileText className="h-5 w-5 mr-2" />
                {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Loan Applications
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {filteredLoans.length} {filteredLoans.length === 1 ? "application" : "applications"} found
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredLoans.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Driver</TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Total Payback</TableHead>
                        <TableHead>Term</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Paid Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLoans.map((loan) => {
                        // Driver and vehicle data are now populated from the API
                        const driverName = loan.driverId?.name || "Unknown Driver"
                        const vehicleName = loan.vehicleId?.name || "Unknown Vehicle"
                        const vehicleYear = loan.vehicleId?.year
                        const vehicleType = loan.vehicleId?.type
                        
                        return (
                          <TableRow key={loan._id}>
                            <TableCell>
                              <div className="font-medium">{driverName}</div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{vehicleName}</div>
                              <div className="text-sm text-muted-foreground">{vehicleYear} {vehicleType}</div>
                            </TableCell>
                            <TableCell>${loan.requestedAmount.toLocaleString()}</TableCell>
                            <TableCell>${loan.totalAmountToPayBack?.toLocaleString() || 'N/A'}</TableCell>
                            <TableCell>{loan.loanTerm} months</TableCell>
                            <TableCell>
                              {new Date(loan.submittedDate).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`
                                  ${loan.status === "Pending" ? "bg-yellow-100 text-yellow-800 border-yellow-300" : ""}
                                  ${loan.status === "Approved" ? "bg-green-100 text-green-800 border-green-300" : ""}
                                  ${loan.status === "Rejected" ? "bg-red-100 text-red-800 border-red-300" : ""}
                                  ${loan.status === "Active" ? "bg-blue-100 text-blue-800 border-blue-300" : ""}
                                `}
                              >
                                {loan.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`
                                  ${loan.downPaymentMade ? "bg-green-100 text-green-800 border-green-300" : "bg-yellow-100 text-yellow-800 border-yellow-300"}
                                `}
                              >
                                {loan.downPaymentMade ? "Paid" : "Pending"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleViewDetails(loan)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {loan.status === "Pending" && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="bg-green-100 text-green-800 border-green-300 hover:bg-green-200"
                                      onClick={() => handleAction(loan, "approve")}
                                      disabled={!loan.downPaymentMade}
                                    >
                                      <CheckCircle className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="bg-red-100 text-red-800 border-red-300 hover:bg-red-200"
                                      onClick={() => handleAction(loan, "reject")}
                                    >
                                      <XCircle className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    No {activeTab !== "all" ? activeTab : ""} loan applications found
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Loan Details Dialog */}
      {selectedLoan && (
        <Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Loan Application Details</DialogTitle>
              <DialogDescription>
                Application ID: {selectedLoan.id}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Driver Information */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-foreground flex items-center text-lg">
                    <User className="h-5 w-5 mr-2" />
                    Driver Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm text-muted-foreground">Name:</span>
                      <p className="font-medium">{selectedLoan.driverId?.name || "Unknown Driver"}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Email:</span>
                      <p className="font-medium">{selectedLoan.driverId?.email || "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Status:</span>
                      <p className="font-medium">{selectedLoan.driverId?.status || "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Joined:</span>
                      <p className="font-medium">
                        {selectedLoan.driverId?.createdAt ? new Date(selectedLoan.driverId.createdAt).toLocaleDateString() : "N/A"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Vehicle Information */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-foreground flex items-center text-lg">
                    <Car className="h-5 w-5 mr-2" />
                    Vehicle Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {selectedLoan.vehicleId?.image && (
                      <div className="mb-3">
                        <Image 
                          src={selectedLoan.vehicleId.image} 
                          alt={selectedLoan.vehicleId.name} 
                          width={200} 
                          height={120} 
                          className="rounded-md object-cover"
                        />
                      </div>
                    )}
                    <div>
                      <span className="text-sm text-muted-foreground">Name:</span>
                      <p className="font-medium">{selectedLoan.vehicleId?.name || "Unknown Vehicle"}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Type:</span>
                      <p className="font-medium">{selectedLoan.vehicleId?.type || "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Year:</span>
                      <p className="font-medium">{selectedLoan.vehicleId?.year || "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Price:</span>
                      <p className="font-medium">${selectedLoan.vehicleId?.price?.toLocaleString() || "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">ROI:</span>
                      <p className="font-medium">{selectedLoan.vehicleId?.roi || "N/A"}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Loan Details */}
              <Card className="bg-card border-border md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-foreground flex items-center text-lg">
                    <DollarSign className="h-5 w-5 mr-2" />
                    Loan Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">Requested Amount:</span>
                      <p className="font-medium">${selectedLoan.requestedAmount.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Total Amount to Pay Back:</span>
                      <p className="font-medium">${selectedLoan.totalAmountToPayBack?.toLocaleString() || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Loan Term:</span>
                      <p className="font-medium">{selectedLoan.loanTerm} months</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Monthly Payment:</span>
                      <p className="font-medium">${selectedLoan.monthlyPayment.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Interest Rate:</span>
                      <p className="font-medium">{selectedLoan.interestRate}%</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Status:</span>
                      <p className="font-medium">
                        <Badge
                          variant="outline"
                          className={`
                            ${selectedLoan.status === "Pending" ? "bg-yellow-100 text-yellow-800 border-yellow-300" : ""}
                            ${selectedLoan.status === "Approved" ? "bg-green-100 text-green-800 border-green-300" : ""}
                            ${selectedLoan.status === "Rejected" ? "bg-red-100 text-red-800 border-red-300" : ""}
                            ${selectedLoan.status === "Active" ? "bg-blue-100 text-blue-800 border-blue-300" : ""}
                          `}
                        >
                          {selectedLoan.status}
                        </Badge>
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Submitted Date:</span>
                      <p className="font-medium">{new Date(selectedLoan.submittedDate).toLocaleDateString()}</p>
                    </div>
                    {selectedLoan.reviewedDate && (
                      <div>
                        <span className="text-sm text-muted-foreground">Reviewed Date:</span>
                        <p className="font-medium">{new Date(selectedLoan.reviewedDate).toLocaleDateString()}</p>
                      </div>
                    )}
                    {selectedLoan.approvedDate && (
                      <div>
                        <span className="text-sm text-muted-foreground">Approved Date:</span>
                        <p className="font-medium">{new Date(selectedLoan.approvedDate).toLocaleDateString()}</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4">
                    <span className="text-sm text-muted-foreground">Loan Purpose:</span>
                    <p className="mt-1 p-2 bg-muted rounded-md">{selectedLoan.purpose || "No purpose specified"}</p>
                  </div>

                  <div className="mt-4">
                    <span className="text-sm text-muted-foreground">Collateral/Security:</span>
                    <p className="mt-1 p-2 bg-muted rounded-md">{selectedLoan.collateral || "No collateral specified"}</p>
                  </div>

                  <div className="mt-4">
                    <span className="text-sm text-muted-foreground">Down Payment Status:</span>
                    <div className="mt-1 p-2 bg-muted rounded-md flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`
                          ${selectedLoan.downPaymentMade ? "bg-green-100 text-green-800 border-green-300" : "bg-yellow-100 text-yellow-800 border-yellow-300"}
                        `}
                      >
                        {selectedLoan.downPaymentMade ? "Paid" : "Pending"}
                      </Badge>
                      <span className="text-sm">
                        {selectedLoan.downPaymentMade 
                          ? "Driver has completed the down payment" 
                          : "Waiting for driver to make down payment"}
                      </span>
                    </div>
                  </div>

                  {selectedLoan.adminNotes && (
                    <div className="mt-4">
                      <span className="text-sm text-muted-foreground">Admin Notes:</span>
                      <p className="mt-1 p-2 bg-muted rounded-md">{selectedLoan.adminNotes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDetailsDialogOpen(false)}>
                Close
              </Button>
              {selectedLoan.status === "Pending" && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="bg-green-100 text-green-800 border-green-300 hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      setIsDetailsDialogOpen(false)
                      handleAction(selectedLoan, "approve")
                    }}
                    disabled={!selectedLoan.downPaymentMade}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {selectedLoan.downPaymentMade ? "Approve" : "Approve (Awaiting Payment)"}
                  </Button>
                  <Button
                    variant="outline"
                    className="bg-red-100 text-red-800 border-red-300 hover:bg-red-200"
                    onClick={() => {
                      setIsDetailsDialogOpen(false)
                      handleAction(selectedLoan, "reject")
                    }}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </Button>
                </div>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Action Confirmation Dialog */}
      <Dialog open={isActionDialogOpen} onOpenChange={setIsActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve" ? "Approve Loan Application" : "Reject Loan Application"}
            </DialogTitle>
            <DialogDescription>
              {actionType === "approve"
                ? "Are you sure you want to approve this loan application?"
                : "Are you sure you want to reject this loan application?"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                Admin Notes {actionType === "reject" && "(Required for rejection)"}
              </label>
              <Textarea
                placeholder={actionType === "approve" ? "Optional notes about this approval" : "Reason for rejection"}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsActionDialogOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAction}
              disabled={isSubmitting || (actionType === "reject" && !adminNotes.trim())}
              className={actionType === "approve" ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {actionType === "approve" ? (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Confirm Approval
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 mr-2" />
                      Confirm Rejection
                    </>
                  )}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}