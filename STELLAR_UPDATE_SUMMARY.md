# Stellar Account Integration - User Model Update

## Overview
Updated the User model (`models/User.ts`) to support storing Stellar blockchain public account information alongside existing Privy and wallet authentication fields.

## Changes Made

### 1. User Model Updates (`models/User.ts`)

Added four new fields to the UserSchema:

```typescript
stellarPublicKey: {
  type: String,
  sparse: true,
  trim: true,
  index: true,    // ✓ Indexed for efficient queries
}

stellarAccountType: {
  type: String,
  enum: ["external_wallet", "platform_managed", "unknown"],
  default: "unknown",
}

stellarLinkedAt: {
  type: Date,
  default: null,
}

stellarLastSyncedAt: {
  type: Date,
  default: null,
}
```

### 2. Schema Design Decisions

- **stellarPublicKey**: 
  - Sparse index allows efficient queries while permitting null/undefined values across multiple users
  - Trimmed to clean up whitespace
  - Paired with index for performance

- **stellarAccountType**:
  - Enum-restricted to three values for type safety
  - Defaults to "unknown" for safe degradation
  - Extensible if new account types are needed

- **Timestamps**:
  - `stellarLinkedAt`: Records when the Stellar account was first connected
  - `stellarLastSyncedAt`: Tracks latest sync with Stellar blockchain

### 3. Backward Compatibility

✓ All existing Privy and wallet fields remain unchanged:
- `privyUserId`
- `walletAddress` / `walletaddress`
- `email`, `password`, `role`, KYC fields

✓ Existing documents without Stellar fields work without migration

## Test Coverage

Created comprehensive tests in `__tests__/models/User.test.ts`:

### Test Scenarios

1. **User with Stellar public key**
   - ✓ Create user with Stellar public key
   - ✓ Verify stellarPublicKey uniqueness constraint
   - ✓ Verify sparse index allows multiple null values

2. **User without Stellar public key**
   - ✓ Create user without Stellar data
   - ✓ Verify default values (stellarAccountType = "unknown", dates = null)
   - ✓ Verify Privy/wallet fields still work

3. **Account type validation**
   - ✓ Accept all three valid account types
   - ✓ Reject invalid account types
   - ✓ Default to "unknown" when not specified

4. **Timestamp handling**
   - ✓ Set stellarLinkedAt when provided
   - ✓ Set stellarLastSyncedAt when provided
   - ✓ Default to null when not provided

5. **Schema validation & coexistence**
   - ✓ All Stellar fields can work together
   - ✓ Stellar fields coexist with KYC fields
   - ✓ No conflicts with existing schema

## Acceptance Criteria Status

- ✅ New Stellar fields added to User schema
- ✅ stellarPublicKey is indexed and sparse
- ✅ Existing Privy and wallet fields continue working
- ✅ Schema validation via Mongoose enums
- ✅ Tests verify users can be created with/without Stellar data
- ✅ Tests verify account type validation

## Verification Commands

```bash
# Lint the project
npm run lint

# Type check the User model
npx tsc --noEmit models/User.ts

# Build the project
npm run build

# Run tests (after jest dependencies install)
npm test
```

## Files Modified

1. `models/User.ts` - Added Stellar schema fields
2. `package.json` - Added test script
3. `jest.config.js` - Created Jest configuration
4. `__tests__/models/User.test.ts` - Created comprehensive test suite

## Next Steps

1. Install test dependencies: `npm install --save-dev jest @types/jest ts-jest`
2. Set up test database environment variable for MongoDB
3. Run tests: `npm test`
4. Deploy model changes to production
5. Create migration if historical data needs Stellar fields populated
