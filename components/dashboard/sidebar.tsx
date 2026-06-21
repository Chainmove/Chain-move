"use client"

import { useEffect, useMemo, useState, type ComponentType } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Calendar,
  Car,
  ChevronDown,
  Coins,
  Compass,
  FileText,
  Gauge,
  Layers,
  LayoutDashboard,
  LogOut,
  Receipt,
  ShieldAlert,
  Settings,
  UserCheck,
  Users,
  Vote,
  Wallet,
  X,
} from "lucide-react"

import { ChainMoveLogo } from "@/components/chain-move-logo"
import { getDashboardSidebarEventNames } from "@/components/dashboard/sidebar-events"
import { useToast } from "@/components/ui/use-toast"
import { useLogout } from "@/lib/privy/react-auth"
import { cn } from "@/lib/utils"

type DashboardRole = "driver" | "investor" | "admin"

interface SidebarItemConfig {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
}

interface SidebarSectionConfig {
  id: string
  label: string
  items: SidebarItemConfig[]
  defaultExpanded?: boolean
}

interface SidebarProps {
  role: DashboardRole
  className?: string
  mobileWidth?: string
}

interface SidebarItemProps {
  item: SidebarItemConfig
  isActive: boolean
  onNavigate: () => void
}

interface SidebarSectionProps {
  section: SidebarSectionConfig
  pathname: string
  onNavigate: () => void
}

const SIDEBAR_SECTIONS: Record<DashboardRole, SidebarSectionConfig[]> = {
  investor: [
    {
      id: "investor-overview",
      label: "Overview",
      defaultExpanded: true,
      items: [{ label: "Dashboard", href: "/dashboard/investor", icon: LayoutDashboard }],
    },
    {
      id: "investor-investments",
      label: "Investments",
      defaultExpanded: true,
      items: [
        { label: "Portfolio", href: "/dashboard/investor/investments", icon: Layers },
        { label: "Explore Opportunities", href: "/dashboard/investor/opportunities", icon: Compass },
      ],
    },
    {
      id: "investor-finances",
      label: "Finances",
      defaultExpanded: true,
      items: [
        { label: "My Wallet", href: "/dashboard/investor/wallet", icon: Wallet },
        { label: "Transaction Ledger", href: "/dashboard/investor/ledger", icon: Receipt },
      ],
    },
    {
      id: "investor-account",
      label: "Account",
      defaultExpanded: true,
      items: [
        { label: "Settings", href: "/dashboard/investor/settings", icon: Settings },
        { label: "KYC", href: "/dashboard/investor/kyc", icon: UserCheck },
      ],
    },
  ],
  driver: [
    {
      id: "driver-overview",
      label: "Overview",
      defaultExpanded: true,
      items: [{ label: "Dashboard", href: "/dashboard/driver", icon: LayoutDashboard }],
    },
    {
      id: "driver-hire-purchase",
      label: "Hire Purchase",
      defaultExpanded: true,
      items: [
        { label: "My Vehicle / Contract", href: "/dashboard/driver/contract", icon: Calendar },
        { label: "Make Payment", href: "/dashboard/driver/repayment", icon: Wallet },
        { label: "Payment History", href: "/dashboard/driver/payments", icon: Receipt },
        { label: "Transaction Ledger", href: "/dashboard/driver/ledger", icon: Receipt },
      ],
    },
    {
      id: "driver-account",
      label: "Account",
      defaultExpanded: true,
      items: [
        { label: "Settings", href: "/dashboard/driver/settings", icon: Settings },
        { label: "KYC", href: "/dashboard/driver/kyc", icon: UserCheck },
      ],
    },
  ],
  admin: [
    {
      id: "admin-overview",
      label: "Overview",
      defaultExpanded: true,
      items: [{ label: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard }],
    },
    {
      id: "admin-management",
      label: "Management",
      defaultExpanded: true,
      items: [
        { label: "Users", href: "/dashboard/admin/users", icon: Users },
        { label: "Investors", href: "/dashboard/admin/investors", icon: Coins },
        { label: "Drivers", href: "/dashboard/admin/drivers", icon: Car },
        { label: "Vehicles", href: "/dashboard/admin/vehicles", icon: Car },
        { label: "Fleet Operations", href: "/dashboard/admin/fleet-operations", icon: Gauge },
      ],
    },
    {
      id: "admin-governance",
      label: "Governance",
      defaultExpanded: true,
      items: [
        { label: "Reports", href: "/dashboard/admin/reports", icon: FileText },
        { label: "Transaction Ledger", href: "/dashboard/admin/ledger", icon: Receipt },
        { label: "Issues", href: "/dashboard/admin/issues", icon: ShieldAlert },
        { label: "Governance", href: "/dashboard/admin/governance", icon: Vote },
      ],
    },
  ],
}

function isActivePath(pathname: string, href: string) {
  const isRootDashboard =
    href === "/dashboard/investor" || href === "/dashboard/driver" || href === "/dashboard/admin"

  if (isRootDashboard) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SidebarItem({ item, isActive, onNavigate }: SidebarItemProps) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
        isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
      aria-current={isActive ? "page" : undefined}
    >
      <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-foreground" : "text-muted-foreground")} />
      <span className="truncate">{item.label}</span>
      {isActive ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden="true" /> : null}
    </Link>
  )
}

export function SidebarSection({ section, pathname, onNavigate }: SidebarSectionProps) {
  const [isExpanded, setIsExpanded] = useState(section.defaultExpanded ?? true)

  return (
    <section className="space-y-1.5">
      <button
        type="button"
        onClick={() => setIsExpanded((previous) => !previous)}
        className="flex w-full items-center justify-between px-2 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{section.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isExpanded ? "rotate-0" : "-rotate-90")} />
      </button>

      {isExpanded ? (
        <div className="space-y-1">
          {section.items.map((item) => (
            <SidebarItem key={item.href} item={item} isActive={isActivePath(pathname, item.href)} onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function Sidebar({ role, className, mobileWidth = "w-[calc(100vw-1rem)] max-w-[18rem]" }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { toast } = useToast()
  const { logout } = useLogout()

  const sections = useMemo(() => SIDEBAR_SECTIONS[role], [role])

  const closeMobileSidebar = () => setIsOpen(false)

  useEffect(() => {
    queueMicrotask(() => {
      setIsOpen(false)
    })
    // Close drawer on route changes to avoid stale overlays.
  }, [pathname])

  useEffect(() => {
    const eventNames = getDashboardSidebarEventNames()
    const handleToggle = () => setIsOpen((previous) => !previous)
    const handleClose = () => setIsOpen(false)

    window.addEventListener(eventNames.toggle, handleToggle)
    window.addEventListener(eventNames.close, handleClose)

    return () => {
      window.removeEventListener(eventNames.toggle, handleToggle)
      window.removeEventListener(eventNames.close, handleClose)
    }
  }, [])

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
      await logout().catch(() => undefined)

      toast({
        title: "Logged out",
        description: "Your session has ended successfully.",
      })

      router.push("/signin")
      router.refresh()
    } catch {
      toast({
        title: "Logout failed",
        description: "Something went wrong while logging out.",
        variant: "destructive",
      })
    }
  }

  return (
    <>
      {isOpen ? (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-[1px] md:hidden"
          onClick={closeMobileSidebar}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 border-r border-border bg-background/95 shadow-xl shadow-black/5 transition-transform duration-300 ease-out supports-[backdrop-filter]:bg-background/90 dark:shadow-black/30",
          mobileWidth,
          "md:w-64 md:translate-x-0 lg:w-72",
          isOpen ? "translate-x-0" : "-translate-x-full",
          className,
        )}
        aria-label="Sidebar navigation"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-[60px] items-center justify-between border-b border-border px-4">
            <Link href="/" className="inline-flex items-center gap-2" onClick={closeMobileSidebar}>
              <ChainMoveLogo width={24} height={24} className="h-6 w-6" />
              <span className="text-xl font-semibold leading-none text-foreground">ChainMove</span>
            </Link>
            <button
              type="button"
              onClick={closeMobileSidebar}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/80 hover:text-foreground md:hidden"
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
            {sections.map((section) => (
              <SidebarSection key={section.id} section={section} pathname={pathname} onNavigate={closeMobileSidebar} />
            ))}
          </nav>

          <div className="border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
