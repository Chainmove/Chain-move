"use client"

import type { FC, ReactNode } from "react"

import { PrivyProvider } from "@/lib/privy/react-auth"
import { embeddedWalletProviderConfig } from "@/lib/wallet/config"

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID

export const Providers: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <PrivyProvider
      appId={privyAppId || ""}
      config={embeddedWalletProviderConfig}
    >
      {children}
    </PrivyProvider>
  )
}
