# Wallet Abstraction Layer

This document describes the wallet abstraction layer that separates authentication, application user identity, and blockchain account details to support ChainMove's transition to Stellar.

## Overview

The wallet abstraction provides a clean separation of concerns:

- **Authentication**: Handled by Privy (no changes to current flow)
- **Application Identity**: User profile data from MongoDB
- **Blockchain Accounts**: Abstracted wallet/account representation that works across chains

## Architecture

### Core Types

Located in `types/wallet.ts`:

- `WalletNetwork`: Supported networks (`stellar-testnet`, `stellar-mainnet`, `lisk-sepolia`, `unknown`)
- `WalletType`: Wallet types (`embedded`, `stellar`, `evm`, `unknown`)
- `BlockchainAccount`: Represents a blockchain account with public key, network, and type
- `WalletIdentity`: User identity information (userId, privyUserId, email, phone, name)
- `WalletMetadata`: Network metadata (network label, explorer URLs, testnet flag)
- `WalletState`: Complete wallet state combining identity, accounts, and metadata

### Wallet Context

Located in `contexts/wallet-context.tsx`:

Provides a React context that:
- Manages wallet state across the application
- Fetches and syncs user data from the backend
- Supports multiple blockchain accounts per user
- Allows switching between networks
- Provides methods to update identity and manage accounts

### Wallet Hook

Located in `hooks/use-wallet.ts`:

Provides a convenient hook for components to access wallet functionality:

```typescript
const {
  identity,
  accounts,
  primaryAccount,
  primaryAddress,
  stellarAccount,
  evmAccount,
  hasStellarAccount,
  hasEvmAccount,
  isReady,
  network,
  networkLabel,
  isTestnet,
  updateIdentity,
  addAccount,
  setPrimaryAccount,
  switchNetwork,
  refreshWallet,
} = useWallet()
```

### Wallet Adapters

Located in `lib/wallet/wallet-adapter.ts`:

Provides adapter pattern for different wallet types:
- `StellarWalletAdapter`: Placeholder for future Stellar wallet integration
- `EmbeddedWalletAdapter`: Handles Privy embedded wallets
- `EvmWalletAdapter`: Handles external EVM wallets

## Usage Examples

### Basic Wallet Access

```typescript
import { useWallet } from "@/hooks/use-wallet"

function MyComponent() {
  const { primaryAddress, isReady, stellarAccount } = useWallet()

  if (!isReady) {
    return <div>Loading wallet...</div>
  }

  return (
    <div>
      <p>Primary Address: {primaryAddress}</p>
      {stellarAccount && (
        <p>Stellar Account: {stellarAccount.publicKey}</p>
      )}
    </div>
  )
}
```

### Checking Network Support

```typescript
import { useWallet } from "@/hooks/use-wallet"
import { isStellarAccount } from "@/types/wallet"

function NetworkAwareComponent() {
  const { primaryAccount, network } = useWallet()

  if (primaryAccount && isStellarAccount(primaryAccount)) {
    return <div>Using Stellar network: {network}</div>
  }

  return <div>Using non-Stellar network</div>
}
```

### Adding a Stellar Account

```typescript
import { useWallet } from "@/hooks/use-wallet"

function AddStellarAccount() {
  const { addAccount, setPrimaryAccount } = useWallet()

  const handleAddStellar = (publicKey: string) => {
    addAccount({
      publicKey,
      accountId: publicKey,
      network: "stellar-testnet",
      type: "stellar",
      linked: true,
    })
    setPrimaryAccount(publicKey)
  }

  return <button onClick={() => handleAddStellar("G...")}>Add Stellar</button>
}
```

## Integration Points

### Providers

The `WalletProvider` is integrated into `app/Providers.tsx` and wraps the entire application. It automatically detects the target Stellar network from `STELLAR_NETWORK` environment variable.

### Authentication Flow

1. User authenticates through Privy (unchanged)
2. Backend creates/updates user in MongoDB (unchanged)
3. `WalletProvider` fetches user data from `/api/auth/me`
4. Wallet state is constructed from:
   - User profile data (identity)
   - Stellar public key from database
   - Privy embedded wallet addresses
   - Stored wallet addresses

### Backend Compatibility

The abstraction works with existing backend structure:
- User model already has `stellarPublicKey`, `walletAddress`, and `privyUserId` fields
- No database schema changes required
- Existing auth endpoints remain functional

## Transitional Elements

### Current EVM/Lisk Support

The abstraction still supports Lisk Sepolia and embedded EVM wallets through:
- `WalletNetwork.lisk-sepolia`
- `WalletType.embedded` and `WalletType.evm`
- `EmbeddedWalletAdapter` and `EvmWalletAdapter`

These remain functional but are clearly isolated in the type system.

### Privy Authentication

Privy authentication is preserved:
- Login methods remain unchanged
- Embedded wallet creation continues
- Privy user sync works as before

The wallet abstraction layer sits above Privy and treats it as one source of identity and wallet addresses.

## Future Stellar Integration

### Planned Additions

When full Stellar integration is ready:

1. **Stellar Wallet Connection**:
   - Implement Freighter, Albedo, or other Stellar wallet support in `StellarWalletAdapter`
   - Add wallet connection UI
   - Store Stellar public key in user profile

2. **Transaction Signing**:
   - Add transaction building and signing methods to adapters
   - Implement Stellar transaction submission
   - Add transaction status tracking

3. **Soroban Contract Interaction**:
   - Add contract invocation support
   - Handle contract events and results
   - Map contract data to application state

4. **Account Management**:
   - Support multiple Stellar accounts per user
   - Account switching
   - Balance queries

### Environment Variables

Add to `.env.local` when ready:

```bash
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_ASSET_CODE=CMOVE
STELLAR_ISSUER_PUBLIC_KEY=G...
STELLAR_DISTRIBUTION_PUBLIC_KEY=G...
STELLAR_CONTRACT_ID=C...
```

## Migration Path

### Phase 1: Current State (Complete)

- Wallet abstraction layer created
- Types defined for multi-chain support
- Context and hooks implemented
- EVM/Lisk support isolated but functional
- Documentation complete

### Phase 2: Stellar Wallet Integration

- Implement Stellar wallet adapters
- Add wallet connection UI
- Store and sync Stellar accounts
- Test with Testnet

### Phase 3: Transaction Support

- Add transaction building
- Implement signing flows
- Add transaction history
- Handle contract interactions

### Phase 4: Full Stellar Migration

- Make Stellar primary chain
- Deprecate EVM/Lisk flows
- Remove transitional code
- Update documentation

## Testing

### Unit Tests

Test wallet utilities:

```typescript
import { isStellarAccount, isEvmAccount, getPrimaryAccountAddress } from "@/types/wallet"

// Test account type detection
const stellarAcc = { network: "stellar-testnet", type: "stellar", ... }
expect(isStellarAccount(stellarAcc)).toBe(true)
```

### Integration Tests

Test wallet context:

```typescript
import { renderHook } from "@testing-library/react"
import { useWallet } from "@/hooks/use-wallet"
import { WalletProvider } from "@/contexts/wallet-context"

const wrapper = ({ children }) => (
  <WalletProvider>{children}</WalletProvider>
)

const { result } = renderHook(() => useWallet(), { wrapper })
```

## Security Considerations

### No Private Key Storage

The abstraction layer does NOT store:
- Private keys
- Secret keys
- Mnemonic phrases
- Privy app secrets

All sensitive cryptographic material remains in:
- Privy's secure infrastructure (for embedded wallets)
- User's browser wallet extension (for external wallets)
- Hardware wallets (future support)

### Public Key Storage Only

The application only stores:
- Public keys / addresses
- Account IDs
- Network identifiers
- Linking metadata

### Server-Side Secrets

Server-only secrets (Privy app secret, etc.) remain in:
- Environment variables
- Backend APIs only
- Never exposed to client

## Troubleshooting

### Wallet Not Loading

1. Check Privy configuration in `app/Providers.tsx`
2. Verify `/api/auth/me` endpoint returns user data
3. Check browser console for errors
4. Ensure `WalletProvider` wraps the app

### Missing Stellar Account

1. Verify `stellarPublicKey` field in User model
2. Check if user has Stellar account in database
3. Ensure network matches (`stellar-testnet` vs `stellar-mainnet`)

### Network Mismatch

1. Check `STELLAR_NETWORK` environment variable
2. Verify `getStellarConfig()` returns correct network
3. Ensure `defaultNetwork` prop matches configuration

## References

- [Stellar Documentation](https://developers.stellar.org/)
- [Privy Documentation](https://docs.privy.io/)
- [Soroban Documentation](https://soroban.stellar.org/)
- ChainMove README.md
