# Stellar Pool Asset Model

## Overview

This document describes the Stellar asset model implementation for mapping ChainMove vehicle investment pools to Stellar blockchain assets.

## Architecture

### Model: StellarPoolAsset

Located in `models/StellarPoolAsset.ts`, this MongoDB model defines the structure for storing Stellar asset information for each investment pool.

#### Fields

- `poolId` (ObjectId, required, unique): Reference to the InvestmentPool
- `assetCode` (String, required): Stellar asset code (1-12 uppercase alphanumeric characters)
- `issuerPublicKey` (String, required): Stellar public key of the asset issuer
- `distributionPublicKey` (String, required): Stellar public key of the distribution account
- `contractId` (String, optional): Soroban smart contract ID for future integration
- `status` (Enum, required): Asset lifecycle status
  - `draft`: Initial creation state
  - `testnet`: Deployed to Stellar testnet
  - `active`: Live on mainnet
  - `retired`: No longer active
- `network` (String, required): Stellar network (testnet/mainnet)
- `metadata` (Object, optional):
  - `name`: Human-readable asset name
  - `description`: Asset description
  - `tomlUrl`: URL to stellar.toml file
  - `imageUrl`: Asset image URL

#### Validation Rules

1. Asset code must be 1-12 characters
2. Asset code must contain only uppercase letters and numbers
3. Issuer and distribution public keys must be valid Stellar ed25519 public keys
4. Each pool can have only one associated asset (enforced by unique poolId)
5. Network names are normalized to lowercase

### Library: pool-assets.ts

Located in `lib/stellar/pool-assets.ts`, this module provides business logic for managing pool assets.

#### Key Functions

##### generatePoolAssetCode(poolId: string, assetType: PoolAssetType): string

Generates a standardized asset code for a pool based on:
- Asset type (SHUTTLE → "SHUT" prefix, KEKE → "KEKE" prefix)
- Last 6 characters of the pool ID (uppercase)

Examples:
- Pool ID: `507f1f77bcf86cd799439011`, Type: SHUTTLE → `SHUT439011`
- Pool ID: `507f1f77bcf86cd799439abc`, Type: KEKE → `KEKE9439ABC`

##### validateAssetCode(assetCode: string): { valid: boolean; error?: string }

Validates asset code format:
- Non-empty
- Maximum 12 characters
- Uppercase alphanumeric only

##### createPoolAsset(input: CreatePoolAssetInput): Promise<PoolAssetSummary>

Creates a new Stellar asset record for a pool:
- Validates pool exists
- Ensures no duplicate asset exists
- Generates asset code automatically
- Falls back to global issuer/distribution keys from config
- Validates all Stellar public keys

##### getPoolAsset(poolId: string): Promise<PoolAssetSummary | null>

Retrieves asset information for a specific pool.

##### updatePoolAssetStatus(poolId: string, status: StellarAssetStatus): Promise<PoolAssetSummary | null>

Updates the asset lifecycle status.

##### listPoolAssets(filters?: { status?: StellarAssetStatus; network?: string }): Promise<PoolAssetSummary[]>

Lists all pool assets with optional filtering by status and network.

## Asset Code Naming Rules

### Format

```
<PREFIX><POOL_ID_SUFFIX>
```

### Prefix Rules

- SHUTTLE assets: `SHUT` (4 characters)
- KEKE assets: `KEKE` (4 characters)

### Pool ID Suffix Rules

- Last 6 characters of MongoDB ObjectId
- Automatically converted to uppercase
- Ensures uniqueness across pools

### Validation

- Total length: 1-12 characters (Stellar limit)
- Characters: Uppercase letters and numbers only
- No special characters or spaces

## Integration with Stellar Config

The pool asset system integrates with existing Stellar configuration (`lib/stellar/config.ts`):

```typescript
const config = getStellarConfig()
// Uses config.issuerPublicKey as default issuer
// Uses config.distributionPublicKey as default distribution account
// Uses config.network to set asset network
```

## Usage Examples

### Creating a Pool Asset

```typescript
import { createPoolAsset } from '@/lib/stellar/pool-assets'

const asset = await createPoolAsset({
  poolId: '507f1f77bcf86cd799439011',
  issuerPublicKey: 'GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX',
  distributionPublicKey: 'GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB',
  status: 'draft',
  metadata: {
    name: 'SHUTTLE Investment Pool',
    description: 'Fractional ownership of shuttle vehicle'
  }
})
```

### Retrieving a Pool Asset

```typescript
import { getPoolAsset } from '@/lib/stellar/pool-assets'

const asset = await getPoolAsset('507f1f77bcf86cd799439011')
if (asset) {
  console.log(`Asset Code: ${asset.assetCode}`)
  console.log(`Status: ${asset.status}`)
}
```

### Updating Asset Status

```typescript
import { updatePoolAssetStatus } from '@/lib/stellar/pool-assets'

await updatePoolAssetStatus('507f1f77bcf86cd799439011', 'testnet')
```

### Listing Active Assets

```typescript
import { listPoolAssets } from '@/lib/stellar/pool-assets'

const activeAssets = await listPoolAssets({ status: 'active', network: 'mainnet' })
```

## Testing

### Unit Tests

Located in `__tests__/lib/stellar/pool-assets.test.ts` and `__tests__/models/StellarPoolAsset.test.ts`.

Run tests:
```bash
npm run test
```

### Demo Script

Located in `scripts/demo-pool-asset.ts`.

Run demo:
```bash
npm run demo:pool-asset
```

Expected output:
- Generated asset codes for sample pools
- Mock pool asset records
- Asset code validation examples

## Database Indexes

The StellarPoolAsset model includes the following indexes for query optimization:

1. `poolId` (unique): Fast lookup by pool
2. `assetCode` + `issuerPublicKey`: Stellar asset identification
3. `status` + `network`: Filtering by lifecycle and network

## Security Considerations

1. **Public Key Validation**: All Stellar public keys are validated using the existing `lib/validation/stellar.ts` utilities
2. **Unique Pool Mapping**: Database constraint ensures one asset per pool
3. **Input Sanitization**: Asset codes are automatically uppercased and trimmed
4. **Network Isolation**: Assets are tagged with network to prevent testnet/mainnet confusion

## Future Integration Points

### Milestone 5: Soroban Contracts

The `contractId` field is reserved for storing Soroban smart contract addresses that will manage:
- Pool ownership tracking
- Driver repayment records
- Investor payout distribution
- Treasury operations

### Milestone 6: Event Indexing

Pool assets will be used to:
- Map Stellar payment events to specific pools
- Track asset balance changes
- Monitor trustline establishments

### Milestone 7: Product Integration

Pool asset data will power:
- Investor ownership dashboards
- Asset explorer interfaces
- Real-time pool funding status
- Blockchain transaction verification

## Metadata and stellar.toml

The `metadata.tomlUrl` field should point to a stellar.toml file containing asset information per SEP-0001 standard:

```toml
[[CURRENCIES]]
code = "SHUT439011"
issuer = "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX"
display_decimals = 0
name = "SHUTTLE Investment Pool"
desc = "Fractional ownership shares of a shuttle vehicle on ChainMove"
image = "https://chainmove.com/assets/shuttle-pool.png"
```

## Error Handling

All functions throw descriptive errors for:
- Invalid pool IDs
- Missing or invalid Stellar public keys
- Duplicate asset creation attempts
- Invalid status transitions
- Malformed asset codes

Error messages are designed to be user-facing and actionable.
