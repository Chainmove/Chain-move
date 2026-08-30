# Migration Guide: Using the Wallet Abstraction

This guide helps developers migrate existing code to use the new wallet abstraction layer.

## Quick Start

### Before (Direct Privy Usage)

```typescript
import { usePrivy, useWallets } from "@privy-io/react-auth"

function MyComponent() {
  const { user } = usePrivy()
  const { wallets } = useWallets()
  
  const walletAddress = wallets[0]?.address
  
  return <div>{walletAddress}</div>
}
```

### After (Wallet Abstraction)

```typescript
import { useWallet } from "@/hooks/use-wallet"

function MyComponent() {
  const { primaryAddress, isReady } = useWallet()
  
  if (!isReady) return <div>Loading...</div>
  
  return <div>{primaryAddress}</div>
}
```

## Common Migration Patterns

### Pattern 1: Getting User Information

#### Before

```typescript
import { usePrivy } from "@privy-io/react-auth"

const { user } = usePrivy()
const email = user?.email?.address
const userId = user?.id
```

#### After

```typescript
import { useWallet } from "@/hooks/use-wallet"

const { identity } = useWallet()
const email = identity?.email
const userId = identity?.userId
const privyUserId = identity?.privyUserId
```

### Pattern 2: Getting Wallet Address

#### Before

```typescript
import { useWallets } from "@privy-io/react-auth"

const { wallets } = useWallets()
const embeddedWallet = wallets.find(w => w.walletClientType === "privy")
const address = embeddedWallet?.address
```

#### After

```typescript
import { useWallet } from "@/hooks/use-wallet"

const { primaryAddress, evmAccount } = useWallet()
const address = primaryAddress
```

### Pattern 3: Checking Authentication

#### Before

```typescript
import { usePrivy } from "@privy-io/react-auth"

const { authenticated, ready } = usePrivy()

if (!ready) return <Loading />
if (!authenticated) return <Login />
```

#### After

```typescript
import { useWallet } from "@/hooks/use-wallet"

const { identity, isReady } = useWallet()

if (!isReady) return <Loading />
if (!identity) return <Login />
```

### Pattern 4: Chain-Specific Logic

#### Before

```typescript
// Hardcoded to EVM/Lisk
const isLiskNetwork = true
```

#### After

```typescript
import { useWallet } from "@/hooks/use-wallet"
import { isStellarAccount } from "@/types/wallet"

const { primaryAccount, network } = useWallet()

const isStellar = isStellarAccount(primaryAccount)
const isTestnet = network.includes("testnet")
```

### Pattern 5: Multiple Accounts

#### Before

```typescript
// Only considered one wallet
const { wallets } = useWallets()
const wallet = wallets[0]
```

#### After

```typescript
import { useWallet } from "@/hooks/use-wallet"

const { accounts, stellarAccount, evmAccount } = useWallet()

// Access specific account types
if (stellarAccount) {
  console.log("Stellar:", stellarAccount.publicKey)
}

if (evmAccount) {
  console.log("EVM:", evmAccount.address)
}

// Or iterate all accounts
accounts.forEach(account => {
  console.log(account.type, account.publicKey)
})
```

## Component Migration Examples

### Example 1: Wallet Display Component

#### Before

```typescript
import { usePrivy, useWallets } from "@privy-io/react-auth"

export function WalletDisplay() {
  const { user } = usePrivy()
  const { wallets } = useWallets()
  
  return (
    <div>
      <p>User: {user?.email?.address}</p>
      <p>Wallet: {wallets[0]?.address}</p>
    </div>
  )
}
```

#### After

```typescript
import { useWallet } from "@/hooks/use-wallet"

export function WalletDisplay() {
  const { identity, primaryAddress, isReady } = useWallet()
  
  if (!isReady) return <div>Loading...</div>
  
  return (
    <div>
      <p>User: {identity?.email}</p>
      <p>Wallet: {primaryAddress}</p>
    </div>
  )
}
```

### Example 2: Network Badge Component

#### Before

```typescript
export function NetworkBadge() {
  return <Badge>Lisk Sepolia</Badge>
}
```

#### After

```typescript
import { useWallet } from "@/hooks/use-wallet"

export function NetworkBadge() {
  const { networkLabel, isTestnet } = useWallet()
  
  return (
    <Badge variant={isTestnet ? "secondary" : "default"}>
      {networkLabel}
    </Badge>
  )
}
```

### Example 3: Account Selector

#### Before

```typescript
// Not supported
```

#### After

```typescript
import { useWallet } from "@/hooks/use-wallet"

export function AccountSelector() {
  const { accounts, primaryAccount, setPrimaryAccount } = useWallet()
  
  return (
    <Select
      value={primaryAccount?.publicKey}
      onValueChange={setPrimaryAccount}
    >
      {accounts.map(account => (
        <SelectItem key={account.publicKey} value={account.publicKey}>
          {account.type}: {account.publicKey.slice(0, 8)}...
        </SelectItem>
      ))}
    </Select>
  )
}
```

## API Route Migration

### Pattern: Server-Side Wallet Verification

#### Before

```typescript
import { verifyPrivyToken } from "@/lib/auth/privy"

export async function POST(request: Request) {
  const token = extractPrivyTokenFromRequest(request)
  const payload = await verifyPrivyToken(token)
  
  // Use payload.sub as user ID
}
```

#### After (No change needed)

```typescript
import { verifyPrivyToken } from "@/lib/auth/privy"

export async function POST(request: Request) {
  const token = extractPrivyTokenFromRequest(request)
  const payload = await verifyPrivyToken(token)
  
  // Still works - wallet abstraction is client-side
  // Backend continues to use existing auth
}
```

The wallet abstraction is primarily a frontend concern. Backend authentication through Privy tokens remains unchanged.

## Best Practices

### 1. Always Check isReady

```typescript
const { isReady, identity } = useWallet()

if (!isReady) {
  return <Loading />
}

// Now safe to use identity
```

### 2. Use Type Guards

```typescript
import { isStellarAccount, isEvmAccount } from "@/types/wallet"

const { primaryAccount } = useWallet()

if (isStellarAccount(primaryAccount)) {
  // TypeScript knows this is a Stellar account
  console.log(primaryAccount.accountId)
}
```

### 3. Handle Missing Accounts

```typescript
const { stellarAccount, hasStellarAccount } = useWallet()

if (!hasStellarAccount) {
  return <ConnectStellarWallet />
}

// Safe to use stellarAccount
```

### 4. Refresh After Updates

```typescript
const { refreshWallet } = useWallet()

async function updateProfile() {
  await fetch("/api/profile", { method: "POST", ... })
  await refreshWallet() // Sync latest data
}
```

### 5. Network-Aware Components

```typescript
const { network, isTestnet } = useWallet()

if (isTestnet) {
  return <TestnetBanner />
}
```

## Backwards Compatibility

### Privy Hooks Still Work

You can still use Privy hooks alongside the wallet abstraction:

```typescript
import { usePrivy } from "@/lib/privy/react-auth"
import { useWallet } from "@/hooks/use-wallet"

function Component() {
  const { login, logout } = usePrivy() // Still works
  const { identity } = useWallet() // New abstraction
  
  // Use both as needed
}
```

### Existing Auth Endpoints

All existing auth endpoints remain functional:
- `/api/auth/login`
- `/api/auth/signup`
- `/api/auth/me`
- `/api/auth/logout`

The wallet abstraction consumes these endpoints, no changes needed.

## Troubleshooting

### Issue: wallet is undefined

**Problem**: Using `useWallet` outside of `WalletProvider`

**Solution**: Ensure `WalletProvider` wraps your component in `app/Providers.tsx`

### Issue: Identity is null but user is logged in

**Problem**: `/api/auth/me` endpoint not returning data

**Solution**: Check:
1. JWT token is valid
2. User exists in database
3. Endpoint permissions

### Issue: No Stellar account found

**Problem**: User doesn't have `stellarPublicKey` in database

**Solution**: This is expected until Stellar wallet connection is implemented. Use `hasStellarAccount` to conditionally render UI.

### Issue: Multiple EVM accounts

**Problem**: User has both embedded wallet and stored wallet address

**Solution**: This is intentional. The abstraction tracks all accounts. Use `primaryAccount` for the default, or let user choose via `setPrimaryAccount`.

## Gradual Migration Strategy

You don't need to migrate everything at once. Here's a suggested approach:

### Phase 1: New Components

Use wallet abstraction in all new components going forward.

### Phase 2: Wallet Display

Migrate components that display wallet addresses and user info.

### Phase 3: Network Logic

Migrate components that make network-specific decisions.

### Phase 4: Transaction Flows

When implementing Stellar transactions, use wallet abstraction from the start.

### Phase 5: Legacy Cleanup

Once confident, migrate remaining components and remove direct Privy usage where appropriate.

## Testing

### Unit Test Example

```typescript
import { renderHook } from "@testing-library/react"
import { useWallet } from "@/hooks/use-wallet"
import { WalletProvider } from "@/contexts/wallet-context"

describe("useWallet", () => {
  const wrapper = ({ children }) => (
    <WalletProvider>{children}</WalletProvider>
  )

  it("provides wallet state", () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    
    expect(result.current.isReady).toBeDefined()
    expect(result.current.accounts).toBeInstanceOf(Array)
  })
})
```

### Integration Test Example

```typescript
import { render, screen } from "@testing-library/react"
import { WalletProvider } from "@/contexts/wallet-context"
import MyComponent from "./MyComponent"

describe("MyComponent", () => {
  it("displays wallet address", () => {
    render(
      <WalletProvider>
        <MyComponent />
      </WalletProvider>
    )
    
    // Test component behavior
  })
})
```

## Questions?

Refer to:
- `docs/WALLET_ABSTRACTION.md` for architecture details
- `types/wallet.ts` for type definitions
- `hooks/use-wallet.ts` for hook API
- `contexts/wallet-context.tsx` for context implementation
