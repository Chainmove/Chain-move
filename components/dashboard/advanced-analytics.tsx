"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePlatform } from "@/contexts/platform-context"
import { BarChart3, TrendingUp, DollarSign, Users, Car, Target, Activity, PieChart, LineChart, Loader2  } from "lucide-react"

interface AnalyticsProps {
  userRole: "driver" | "investor" | "admin"
  userId?: string
}

export function AdvancedAnalytics({ userRole, userId }: AnalyticsProps) {
  const { state } = usePlatform()

  if (state.isLoading || !(state as any).drivers || !(state as any).investors || !state.vehicles || !state.loanApplications) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading Analytics...</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  // Calculate analytics data
  const analytics = {
    totalRevenue: state.transactions.filter((t) => t.status === "completed").reduce((sum, t) => sum + t.amount, 0),

    monthlyGrowth: 12.5, // Simulated

    userGrowth: {
      drivers: (state as any).drivers.length,
      investors: (state as any).investors.length,
      growth: 8.3, // Simulated
    },

    loanPerformance: {
      approved: state.loanApplications.filter((l) => l.status === "Approved" || l.status === "Active").length,
      pending: state.loanApplications.filter((l) => l.status === "Pending" || l.status === "Under Review").length,
      rejected: state.loanApplications.filter((l) => l.status === "Rejected").length,
      successRate: 85.7, // Simulated
    },

    investmentMetrics: {
      totalInvested: state.investments.reduce((sum, inv) => sum + inv.amount, 0),
      totalReturns: state.investments.reduce((sum, inv) => sum + inv.totalReturns, 0),
      averageROI:
        state.investments.length > 0
          ? state.investments.reduce((sum, inv) => sum + inv.expectedROI, 0) / state.investments.length
          : 0,
      activeInvestments: state.investments.filter((inv) => inv.status === "Active").length,
    },

    vehicleUtilization: {
      total: state.vehicles.length,
      financed: state.vehicles.filter((v) => v.status === "Financed").length,
      available: state.vehicles.filter((v) => v.status === "Available").length,
      utilizationRate:
        state.vehicles.length > 0
          ? (state.vehicles.filter((v) => v.status === "Financed").length / state.vehicles.length) * 100
          : 0,
    },

    riskDistribution: {
      low: state.loanApplications.filter((l) => l.riskAssessment === "Low").length,
      medium: state.loanApplications.filter((l) => l.riskAssessment === "Medium").length,
      high: state.loanApplications.filter((l) => l.riskAssessment === "High").length,
    },

    monthlyTrends: [
      { month: "Jan", loans: 12, investments: 8, revenue: 45000 },
      { month: "Feb", loans: 15, investments: 12, revenue: 52000 },
      { month: "Mar", loans: 18, investments: 15, revenue: 61000 },
      { month: "Apr", loans: 22, investments: 18, revenue: 68000 },
      { month: "May", loans: 25, investments: 22, revenue: 75000 },
      { month: "Jun", loans: 28, investments: 25, revenue: 82000 },
    ],
  }

  const getPersonalizedAnalytics = () => {
    if (userRole === "driver" && userId) {
      const driverLoans = state.loanApplications.filter((l) => l.driverId === userId)
      const driverTransactions = state.transactions.filter((t) => t.userId === userId)

      return {
        totalBorrowed: driverLoans.reduce((sum, loan) => sum + (loan.totalFunded ?? 0), 0),
        activeLoans: driverLoans.filter((l) => l.status === "Active").length,
        completedPayments: (state as any).repaymentSchedules.filter(
          (r: any) => driverLoans.some((l) => l.id === r.loanId) && r.status === "Paid",
        ).length,
        creditScore: driverLoans[0]?.creditScore || 0,
        paymentHistory: 96.5, // Simulated
      }
    } else if (userRole === "investor" && userId) {
      const investorInvestments = state.investments.filter((i) => i.investorId === userId)
      const investor = (state as any).investors.find((i: any) => i.id === userId)

      return {
        totalInvested: investorInvestments.reduce((sum, inv) => sum + inv.amount, 0),
        totalReturns: investorInvestments.reduce((sum, inv) => sum + inv.totalReturns, 0),
        activeInvestments: investorInvestments.filter((inv) => inv.status === "Active").length,
        averageROI:
          investorInvestments.length > 0
            ? investorInvestments.reduce((sum, inv) => sum + inv.expectedROI, 0) / investorInvestments.length
            : 0,
        portfolioValue: investor?.totalInvested || 0,
      }
    }
    return null
  }

  const personalAnalytics = getPersonalizedAnalytics()

  return (
    <div className="space-y-6">
      {/* Key Metrics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">Total Revenue</p>
                <p className="text-2xl font-bold">${analytics.totalRevenue.toLocaleString()}</p>
                <div className="flex items-center mt-1">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  <span className="text-xs">+{analytics.monthlyGrowth}% this month</span>
                </div>
              </div>
              <DollarSign className="h-8 w-8 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-green-500 to-green-600 text-white border-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">Active Users</p>
                <p className="text-2xl font-bold">{analytics.userGrowth.drivers + analytics.userGrowth.investors}</p>
                <div className="flex items-center mt-1">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  <span className="text-xs">+{analytics.userGrowth.growth}% growth</span>
                </div>
              </div>
              <Users className="h-8 w-8 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-purple-500 to-purple-600 text-white border-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">Loan Success Rate</p>
                <p className="text-2xl font-bold">{analytics.loanPerformance.successRate}%</p>
                <div className="flex items-center mt-1">
                  <Target className="h-3 w-3 mr-1" />
                  <span className="text-xs">{analytics.loanPerformance.approved} approved</span>
                </div>
              </div>
              <BarChart3 className="h-8 w-8 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-orange-500 to-orange-600 text-white border-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">Vehicle Utilization</p>
                <p className="text-2xl font-bold">{analytics.vehicleUtilization.utilizationRate.toFixed(1)}%</p>
                <div className="flex items-center mt-1">
                  <Car className="h-3 w-3 mr-1" />
                  <span className="text-xs">{analytics.vehicleUtilization.financed} financed</span>
                </div>
              </div>
              <Car className="h-8 w-8 opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Personalized Analytics */}
      {personalAnalytics && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center">
              <Activity className="h-5 w-5 mr-2" />
              Your Performance Analytics
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Personalized insights based on your activity
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {userRole === "driver" && (
                <>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">
                      ${personalAnalytics.totalBorrowed?.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Total Borrowed</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{personalAnalytics.activeLoans}</p>
                    <p className="text-sm text-muted-foreground">Active Loans</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{personalAnalytics.completedPayments}</p>
                    <p className="text-sm text-muted-foreground">Payments Made</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{personalAnalytics.creditScore}</p>
                    <p className="text-sm text-muted-foreground">Credit Score</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-500">{personalAnalytics.paymentHistory}%</p>
                    <p className="text-sm text-muted-foreground">Payment History</p>
                  </div>
                </>
              )}

              {userRole === "investor" && (
                <>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">
                      ${personalAnalytics.totalInvested?.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Total Invested</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-500">
                      ${personalAnalytics.totalReturns?.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Total Returns</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{personalAnalytics.activeInvestments}</p>
                    <p className="text-sm text-muted-foreground">Active Investments</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-[#E57700]">{personalAnalytics.averageROI?.toFixed(1)}%</p>
                    <p className="text-sm text-muted-foreground">Average ROI</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">
                      ${personalAnalytics.portfolioValue?.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Portfolio Value</p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detailed Analytics Tabs */}
      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 bg-muted">
          <TabsTrigger value="performance" className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white">
            Performance
          </TabsTrigger>
          <TabsTrigger value="trends" className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white">
            Trends
          </TabsTrigger>
          <TabsTrigger value="risk" className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white">
            Risk Analysis
          </TabsTrigger>
          <TabsTrigger value="forecasting" className="data-[state=active]:bg-[#E57700] data-[state=active]:text-white">
            Forecasting
          </TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-foreground flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2" />
                  Loan Performance Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Approved Loans</span>
                      <span className="text-sm font-medium">{analytics.loanPerformance.approved}</span>
                    </div>
                    <Progress value={75} className="h-2" />
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Pending Review</span>
                      <span className="text-sm font-medium">{analytics.loanPerformance.pending}</span>
                    </div>
                    <Progress value={20} className="h-2" />
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Rejected</span>
                      <span className="text-sm font-medium">{analytics.loanPerformance.rejected}</span>
                    </div>
                    <Progress value={5} className="h-2" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-foreground flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2" />
                  Investment Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Invested</span>
                    <span className="font-bold text-foreground">
                      ${analytics.investmentMetrics.totalInvested.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Returns</span>
                    <span className="font-bold text-green-500">
                      ${analytics.investmentMetrics.totalReturns.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Average ROI</span>
                    <span className="font-bold text-[#E57700]">
                      {analytics.investmentMetrics.averageROI.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active Investments</span>
                    <span className="font-bold text-foreground">{analytics.investmentMetrics.activeInvestments}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center">
                <LineChart className="h-5 w-5 mr-2" />
                Monthly Trends Analysis
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Track platform growth and performance over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {analytics.monthlyTrends.map((month, index) => (
                  <div key={month.month} className="flex items-center space-x-4">
                    <div className="w-12 text-sm font-medium text-muted-foreground">{month.month}</div>
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Loans: {month.loans}</span>
                        <span className="text-muted-foreground">Investments: {month.investments}</span>
                        <span className="text-muted-foreground">Revenue: ${month.revenue.toLocaleString()}</span>
                      </div>
                      <Progress value={(month.revenue / 100000) * 100} className="h-2" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center">
                <PieChart className="h-5 w-5 mr-2" />
                Risk Distribution Analysis
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Overview of risk levels across all loan applications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Low Risk</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full"
                        style={{
                          width: `${(analytics.riskDistribution.low / (analytics.riskDistribution.low + analytics.riskDistribution.medium + analytics.riskDistribution.high)) * 100}%`,
                        }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium w-8">{analytics.riskDistribution.low}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Medium Risk</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-yellow-500 h-2 rounded-full"
                        style={{
                          width: `${(analytics.riskDistribution.medium / (analytics.riskDistribution.low + analytics.riskDistribution.medium + analytics.riskDistribution.high)) * 100}%`,
                        }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium w-8">{analytics.riskDistribution.medium}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">High Risk</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full"
                        style={{
                          width: `${(analytics.riskDistribution.high / (analytics.riskDistribution.low + analytics.riskDistribution.medium + analytics.riskDistribution.high)) * 100}%`,
                        }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium w-8">{analytics.riskDistribution.high}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecasting" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center">
                <Target className="h-5 w-5 mr-2" />
                Predictive Analytics & Forecasting
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                AI-powered predictions for platform growth and performance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-semibold text-foreground">Next 6 Months Forecast</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expected New Loans</span>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-foreground">45-52</span>
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Projected Revenue</span>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-foreground">$125K-$140K</span>
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">User Growth</span>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-foreground">15-20%</span>
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-semibold text-foreground">Risk Predictions</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Default Risk</span>
                      <Badge className="bg-green-100 text-green-800">Low (2.3%)</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Market Volatility</span>
                      <Badge className="bg-yellow-100 text-yellow-800">Medium</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Liquidity Risk</span>
                      <Badge className="bg-green-100 text-green-800">Low</Badge>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
