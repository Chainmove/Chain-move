#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, xdr::ToXdr, Address, BytesN, Env,
    String, Symbol,
};

#[contract]
pub struct ChainMovePoolContract;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    InvalidInput = 1,
    PoolAlreadyExists = 2,
    PoolNotFound = 3,
    InvestorPositionNotFound = 4,
    Oversubscribed = 5,
    PoolInactive = 6,
    WrongAsset = 7,
    InsufficientAllowance = 8,
    ArithmeticOverflow = 9,
    DuplicateReference = 10,
    Overpayment = 11,
    RepayerMismatch = 12,
    NothingToRefund = 13,
    RefundTooSmall = 14,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pool {
    pub id: u64,
    pub owner: Address,
    pub repayer: Address,
    pub asset: Address,
    pub asset_label: String,
    pub total_units: u64,
    pub funded_units: u64,
    pub target_amount: i128,
    pub total_invested: i128,
    pub total_repaid: i128,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvestorPosition {
    pub pool_id: u64,
    pub investor: Address,
    pub units: u64,
    pub invested: i128,
    pub repaid: i128,
    pub refunded: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransitionEvent {
    pub version: u32,
    pub asset: Address,
    pub amount: i128,
    pub pool_id: u64,
    pub position_id: Address,
    pub actor: Address,
    pub reference: String,
    pub post_funded_units: u64,
    pub post_total_invested: i128,
    pub post_total_repaid: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum OperationKind {
    Funding,
    Repayment,
    Refund,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
struct OperationReceipt {
    kind: OperationKind,
    pool_id: u64,
    participant: Address,
    amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
struct RefundBasis {
    basis_invested: i128,
    basis_units: u64,
    cumulative_refunded: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Pool(u64),
    InvestorPosition(u64, Address),
    // Legacy global reference key: scoped only by the raw external reference.
    // Retained solely so receipts written before the scoped key existed can
    // still be recognized as idempotent replays. Never written to anymore.
    Reference(String),
    // Reference key scoped by domain/version, operation kind, pool, and actor,
    // then hashed to a fixed-size digest so an unrelated pool/operation/actor
    // can never collide with (or be blocked by) another scope's reference,
    // and storage cost stays bounded regardless of external reference length.
    ScopedReference(BytesN<32>),
    RefundBasis(u64, Address),
    LegacyPool(u64), // Legacy key format for migration testing
}

const DAY_IN_LEDGERS: u32 = 17280;
const RENT_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
const RENT_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const REFERENCE_KEY_DOMAIN: u32 = 1;

#[contractimpl]
impl ChainMovePoolContract {
    pub fn create_pool(
        env: Env,
        owner: Address,
        repayer: Address,
        pool_id: u64,
        asset: Address,
        asset_label: String,
        total_units: u64,
        target_amount: i128,
    ) -> Result<Pool, ContractError> {
        owner.require_auth();
        env.storage().instance().extend_ttl(RENT_THRESHOLD, RENT_EXTEND_TO);

        if pool_id == 0 || total_units == 0 || target_amount <= 0 || asset_label.is_empty() {
            return Err(ContractError::InvalidInput);
        }

        let key = DataKey::Pool(pool_id);
        if env.storage().persistent().has(&key) {
            return Err(ContractError::PoolAlreadyExists);
        }

        let pool = Pool {
            id: pool_id,
            owner,
            repayer,
            asset,
            asset_label,
            total_units,
            funded_units: 0,
            target_amount,
            total_invested: 0,
            total_repaid: 0,
            active: true,
        };

        env.storage().persistent().set(&key, &pool);
        env.storage().persistent().extend_ttl(&key, RENT_THRESHOLD, RENT_EXTEND_TO);

        publish_transition(
            &env,
            Symbol::new(&env, "pool_created_v1"),
            &asset,
            target_amount,
            pool_id,
            owner.clone(),
            owner.clone(),
            String::from_str(&env, "genesis"),
            0,
            0,
            0,
        );

        Ok(pool)
    }

    pub fn fund_pool(
        env: Env,
        investor: Address,
        pool_id: u64,
        asset: Address,
        amount: i128,
        reference: String,
    ) -> Result<InvestorPosition, ContractError> {
        investor.require_auth();
        env.storage().instance().extend_ttl(RENT_THRESHOLD, RENT_EXTEND_TO);

        if pool_id == 0 || amount <= 0 || reference.is_empty() {
            return Err(ContractError::InvalidInput);
        }

        if let Some(position) = read_idempotent_position(
            &env,
            &reference,
            OperationKind::Funding,
            pool_id,
            investor.clone(),
            amount,
        )? {
            return Ok(position);
        }

        let pool_key = DataKey::Pool(pool_id);
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&pool_key)
            .ok_or(ContractError::PoolNotFound)?;
        env.storage().persistent().extend_ttl(&pool_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        if !pool.active {
            return Err(ContractError::PoolInactive);
        }

        if pool.asset != asset {
            return Err(ContractError::WrongAsset);
        }

        let new_total = checked_add_i128(pool.total_invested, amount)?;
        if new_total > pool.target_amount {
            return Err(ContractError::Oversubscribed);
        }

        let units = allocate_units(&pool, amount, new_total)?;
        let new_units = checked_add_u64(pool.funded_units, units)?;
        if new_units > pool.total_units {
            return Err(ContractError::Oversubscribed);
        }

        transfer_from_participant_to_contract(&env, &pool.asset, &investor, amount)?;

        pool.total_invested = new_total;
        pool.funded_units = new_units;
        env.storage().persistent().set(&pool_key, &pool);
        env.storage().persistent().extend_ttl(&pool_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        let position_key = DataKey::InvestorPosition(pool_id, investor.clone());
        let mut position =
            env.storage()
                .persistent()
                .get(&position_key)
                .unwrap_or(InvestorPosition {
                    pool_id,
                    investor: investor.clone(),
                    units: 0,
                    invested: 0,
                    repaid: 0,
                    refunded: 0,
                });

        position.invested = checked_add_i128(position.invested, amount)?;
        position.units = checked_add_u64(position.units, units)?;
        env.storage().persistent().set(&position_key, &position);
        env.storage().persistent().extend_ttl(&position_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        // Any new funding starts a new exact refund epoch from the combined
        // principal/unit position. Subsequent partitioned refunds all resolve
        // against this immutable basis instead of repeatedly rounding ratios.
        let refund_basis_key = DataKey::RefundBasis(pool_id, investor.clone());
        env.storage().persistent().set(
            &refund_basis_key,
            &RefundBasis {
                basis_invested: position.invested,
                basis_units: position.units,
                cumulative_refunded: 0,
            },
        );
        env.storage().persistent().extend_ttl(&refund_basis_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        write_reference(
            &env,
            reference.clone(),
            OperationKind::Funding,
            pool_id,
            investor.clone(),
            amount,
        );
        publish_transition(
            &env,
            Symbol::new(&env, "pool_funded_v1"),
            &pool.asset,
            amount,
            pool_id,
            investor.clone(),
            investor,
            reference,
            pool.funded_units,
            pool.total_invested,
            pool.total_repaid,
        );

        Ok(position)
    }

    pub fn record_repayment(
        env: Env,
        payer: Address,
        pool_id: u64,
        investor: Address,
        asset: Address,
        amount: i128,
        reference: String,
    ) -> Result<InvestorPosition, ContractError> {
        payer.require_auth();
        env.storage().instance().extend_ttl(RENT_THRESHOLD, RENT_EXTEND_TO);

        if pool_id == 0 || amount <= 0 || reference.is_empty() {
            return Err(ContractError::InvalidInput);
        }

        if let Some(position) = read_idempotent_position(
            &env,
            &reference,
            OperationKind::Repayment,
            pool_id,
            investor.clone(),
            amount,
        )? {
            return Ok(position);
        }

        let pool_key = DataKey::Pool(pool_id);
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&pool_key)
            .ok_or(ContractError::PoolNotFound)?;
        env.storage().persistent().extend_ttl(&pool_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        if pool.asset != asset {
            return Err(ContractError::WrongAsset);
        }

        if pool.repayer != payer {
            return Err(ContractError::RepayerMismatch);
        }

        let position_key = DataKey::InvestorPosition(pool_id, investor.clone());
        let mut position: InvestorPosition = env
            .storage()
            .persistent()
            .get(&position_key)
            .ok_or(ContractError::InvestorPositionNotFound)?;
        env.storage().persistent().extend_ttl(&position_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        let outstanding = position
            .invested
            .checked_sub(position.repaid)
            .ok_or(ContractError::ArithmeticOverflow)?;
        if amount > outstanding {
            return Err(ContractError::Overpayment);
        }

        transfer_from_participant_to(&env, &pool.asset, &payer, &investor, amount)?;

        pool.total_repaid = checked_add_i128(pool.total_repaid, amount)?;
        position.repaid = checked_add_i128(position.repaid, amount)?;

        env.storage().persistent().set(&pool_key, &pool);
        env.storage().persistent().extend_ttl(&pool_key, RENT_THRESHOLD, RENT_EXTEND_TO);
        env.storage().persistent().set(&position_key, &position);
        env.storage().persistent().extend_ttl(&position_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        write_reference(
            &env,
            reference.clone(),
            OperationKind::Repayment,
            pool_id,
            investor.clone(),
            amount,
        );
        publish_transition(
            &env,
            Symbol::new(&env, "pool_repaid_v1"),
            &pool.asset,
            amount,
            pool_id,
            investor,
            payer,
            reference,
            pool.funded_units,
            pool.total_invested,
            pool.total_repaid,
        );

        Ok(position)
    }

    pub fn refund_position(
        env: Env,
        owner: Address,
        pool_id: u64,
        investor: Address,
        amount: i128,
        reference: String,
    ) -> Result<InvestorPosition, ContractError> {
        owner.require_auth();
        env.storage().instance().extend_ttl(RENT_THRESHOLD, RENT_EXTEND_TO);

        if pool_id == 0 || amount <= 0 || reference.is_empty() {
            return Err(ContractError::InvalidInput);
        }

        if let Some(position) = read_idempotent_position(
            &env,
            &reference,
            OperationKind::Refund,
            pool_id,
            investor.clone(),
            amount,
        )? {
            return Ok(position);
        }

        let pool_key = DataKey::Pool(pool_id);
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&pool_key)
            .ok_or(ContractError::PoolNotFound)?;
        env.storage().persistent().extend_ttl(&pool_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        if pool.owner != owner {
            return Err(ContractError::InvalidInput);
        }

        let position_key = DataKey::InvestorPosition(pool_id, investor.clone());
        let mut position: InvestorPosition = env
            .storage()
            .persistent()
            .get(&position_key)
            .ok_or(ContractError::InvestorPositionNotFound)?;
        env.storage().persistent().extend_ttl(&position_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        if amount > position.invested {
            return Err(ContractError::NothingToRefund);
        }

        let refund_basis_key = DataKey::RefundBasis(pool_id, investor.clone());
        let mut refund_basis: RefundBasis = env
            .storage()
            .persistent()
            .get(&refund_basis_key)
            .unwrap_or(RefundBasis {
                basis_invested: position.invested,
                basis_units: position.units,
                cumulative_refunded: 0,
            });
        let refund_units = release_units(&position, &refund_basis, amount)?;
        transfer_from_contract_to_participant(&env, &pool.asset, &investor, amount);

        refund_basis.cumulative_refunded = checked_add_i128(refund_basis.cumulative_refunded, amount)?;
        position.refunded = checked_add_i128(position.refunded, amount)?;
        position.invested = checked_sub_i128(position.invested, amount)?;
        position.units = checked_sub_u64(position.units, refund_units)?;
        pool.total_invested = checked_sub_i128(pool.total_invested, amount)?;
        pool.funded_units = checked_sub_u64(pool.funded_units, refund_units)?;
        
        env.storage().persistent().set(&pool_key, &pool);
        env.storage().persistent().extend_ttl(&pool_key, RENT_THRESHOLD, RENT_EXTEND_TO);
        env.storage().persistent().set(&position_key, &position);
        env.storage().persistent().extend_ttl(&position_key, RENT_THRESHOLD, RENT_EXTEND_TO);
        if position.invested == 0 {
            env.storage().persistent().remove(&refund_basis_key);
        } else {
            env.storage().persistent().set(&refund_basis_key, &refund_basis);
            env.storage().persistent().extend_ttl(&refund_basis_key, RENT_THRESHOLD, RENT_EXTEND_TO);
        }

        write_reference(
            &env,
            reference.clone(),
            OperationKind::Refund,
            pool_id,
            investor.clone(),
            amount,
        );
        publish_transition(
            &env,
            Symbol::new(&env, "pool_refund_v1"),
            &pool.asset,
            amount,
            pool_id,
            investor,
            owner,
            reference,
            pool.funded_units,
            pool.total_invested,
            pool.total_repaid,
        );

        Ok(position)
    }

    /// Marks a pool inactive so no further funding is accepted.
    pub fn close_pool(env: Env, owner: Address, pool_id: u64) -> Result<Pool, ContractError> {
        owner.require_auth();
        env.storage().instance().extend_ttl(RENT_THRESHOLD, RENT_EXTEND_TO);

        if pool_id == 0 {
            return Err(ContractError::InvalidInput);
        }

        let key = DataKey::Pool(pool_id);
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::PoolNotFound)?;

        if pool.owner != owner {
            return Err(ContractError::InvalidInput);
        }

        pool.active = false;
        env.storage().persistent().set(&key, &pool);
        env.storage().persistent().extend_ttl(&key, RENT_THRESHOLD, RENT_EXTEND_TO);

        publish_transition(
            &env,
            Symbol::new(&env, "pool_closed_v1"),
            &pool.asset,
            0,
            pool_id,
            owner.clone(),
            owner,
            String::from_str(&env, "pool_closed"),
            pool.funded_units,
            pool.total_invested,
            pool.total_repaid,
        );

        Ok(pool)
    }

    pub fn read_pool(env: Env, pool_id: u64) -> Result<Pool, ContractError> {
        if pool_id == 0 {
            return Err(ContractError::InvalidInput);
        }

        let key = DataKey::Pool(pool_id);
        let legacy_key = DataKey::LegacyPool(pool_id);

        if !env.storage().persistent().has(&key) && env.storage().persistent().has(&legacy_key) {
            // Found a legacy key! Migrate it to the new key representation
            let pool: Pool = env
                .storage()
                .persistent()
                .get(&legacy_key)
                .ok_or(ContractError::PoolNotFound)?;
            env.storage().persistent().set(&key, &pool);
            env.storage().persistent().remove(&legacy_key);
        }

        let pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::PoolNotFound)?;

        env.storage().persistent().extend_ttl(&key, RENT_THRESHOLD, RENT_EXTEND_TO);
        Ok(pool)
    }

    pub fn read_investor_position(
        env: Env,
        investor: Address,
        pool_id: u64,
    ) -> Result<InvestorPosition, ContractError> {
        if pool_id == 0 {
            return Err(ContractError::InvalidInput);
        }

        let key = DataKey::InvestorPosition(pool_id, investor);
        let position: InvestorPosition = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::InvestorPositionNotFound)?;

        env.storage().persistent().extend_ttl(&key, RENT_THRESHOLD, RENT_EXTEND_TO);
        Ok(position)
    }

    /// Returns investor share in basis points (bps): invested * 10_000 / target_amount.
    pub fn get_investor_share(
        env: Env,
        investor: Address,
        pool_id: u64,
    ) -> Result<u64, ContractError> {
        if pool_id == 0 {
            return Err(ContractError::InvalidInput);
        }

        let pool_key = DataKey::Pool(pool_id);
        let pool: Pool = env
            .storage()
            .persistent()
            .get(&pool_key)
            .ok_or(ContractError::PoolNotFound)?;
        env.storage().persistent().extend_ttl(&pool_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        let position_key = DataKey::InvestorPosition(pool_id, investor);
        let position: InvestorPosition = env
            .storage()
            .persistent()
            .get(&position_key)
            .ok_or(ContractError::InvestorPositionNotFound)?;
        env.storage().persistent().extend_ttl(&position_key, RENT_THRESHOLD, RENT_EXTEND_TO);

        let numerator = position
            .invested
            .checked_mul(10_000)
            .ok_or(ContractError::ArithmeticOverflow)?;
        Ok((numerator / pool.target_amount) as u64)
    }
}

fn scoped_reference_key(
    env: &Env,
    kind: &OperationKind,
    pool_id: u64,
    participant: &Address,
    reference: &String,
) -> DataKey {
    let scope = (
        REFERENCE_KEY_DOMAIN,
        kind.clone(),
        pool_id,
        participant.clone(),
        reference.clone(),
    );
    let digest = env.crypto().sha256(&scope.to_xdr(env));
    DataKey::ScopedReference(digest.to_bytes())
}

fn load_investor_position(
    env: &Env,
    pool_id: u64,
    participant: Address,
) -> Result<InvestorPosition, ContractError> {
    let pos_key = DataKey::InvestorPosition(pool_id, participant);
    let position = env
        .storage()
        .persistent()
        .get(&pos_key)
        .ok_or(ContractError::InvestorPositionNotFound)?;
    env.storage().persistent().extend_ttl(&pos_key, RENT_THRESHOLD, RENT_EXTEND_TO);
    Ok(position)
}

fn read_idempotent_position(
    env: &Env,
    reference: &String,
    kind: OperationKind,
    pool_id: u64,
    participant: Address,
    amount: i128,
) -> Result<Option<InvestorPosition>, ContractError> {
    let scoped_key = scoped_reference_key(env, &kind, pool_id, &participant, reference);
    if let Some(receipt) = env
        .storage()
        .persistent()
        .get::<DataKey, OperationReceipt>(&scoped_key)
    {
        env.storage().persistent().extend_ttl(&scoped_key, RENT_THRESHOLD, RENT_EXTEND_TO);
        if receipt.kind != kind
            || receipt.pool_id != pool_id
            || receipt.participant != participant
            || receipt.amount != amount
        {
            return Err(ContractError::DuplicateReference);
        }

        return Ok(Some(load_investor_position(env, pool_id, participant)?));
    }

    // Backward-compatible read for receipts written under the old, unscoped
    // global key. Only an exact match for this operation's scope counts as a
    // replay; any other scope simply ignores the legacy entry instead of
    // erroring, since a stale global key must never be able to block (or be
    // hijacked by) an unrelated pool/operation/actor.
    let legacy_key = DataKey::Reference(reference.clone());
    if let Some(receipt) = env
        .storage()
        .persistent()
        .get::<DataKey, OperationReceipt>(&legacy_key)
    {
        if receipt.kind == kind
            && receipt.pool_id == pool_id
            && receipt.participant == participant
            && receipt.amount == amount
        {
            env.storage().persistent().extend_ttl(&legacy_key, RENT_THRESHOLD, RENT_EXTEND_TO);
            return Ok(Some(load_investor_position(env, pool_id, participant)?));
        }
    }

    Ok(None)
}

fn write_reference(
    env: &Env,
    reference: String,
    kind: OperationKind,
    pool_id: u64,
    participant: Address,
    amount: i128,
) {
    let key = scoped_reference_key(env, &kind, pool_id, &participant, &reference);
    env.storage().persistent().set(
        &key,
        &OperationReceipt {
            kind,
            pool_id,
            participant,
            amount,
        },
    );
    env.storage().persistent().extend_ttl(&key, RENT_THRESHOLD, RENT_EXTEND_TO);
}

fn allocate_units(pool: &Pool, amount: i128, new_total: i128) -> Result<u64, ContractError> {
    if new_total == pool.target_amount {
        return checked_sub_u64(pool.total_units, pool.funded_units);
    }

    let unit_amount = amount
        .checked_mul(pool.total_units as i128)
        .ok_or(ContractError::ArithmeticOverflow)?
        .checked_div(pool.target_amount)
        .ok_or(ContractError::ArithmeticOverflow)?;
    if unit_amount <= 0 {
        return Err(ContractError::InvalidInput);
    }
    u64::try_from(unit_amount).map_err(|_| ContractError::ArithmeticOverflow)
}

fn release_units(
    position: &InvestorPosition,
    basis: &RefundBasis,
    amount: i128,
) -> Result<u64, ContractError> {
    if amount == position.invested {
        return Ok(position.units);
    }

    let cumulative_refunded = checked_add_i128(basis.cumulative_refunded, amount)?;
    let remaining_principal = checked_sub_i128(basis.basis_invested, cumulative_refunded)?;
    let numerator = remaining_principal
        .checked_mul(basis.basis_units as i128)
        .ok_or(ContractError::ArithmeticOverflow)?;
    let quotient = numerator
        .checked_div(basis.basis_invested)
        .ok_or(ContractError::ArithmeticOverflow)?;
    let remainder = numerator
        .checked_rem(basis.basis_invested)
        .ok_or(ContractError::ArithmeticOverflow)?;
    let entitled_units = quotient + i128::from(remainder > 0);
    let entitled_units = u64::try_from(entitled_units).map_err(|_| ContractError::ArithmeticOverflow)?;
    let released = checked_sub_u64(position.units, entitled_units)?;
    if released == 0 {
        // The refund is below the current unit granularity. Reject it explicitly
        // so principal cannot move while all corresponding units are retained.
        return Err(ContractError::RefundTooSmall);
    }
    Ok(released)
}

fn transfer_from_participant_to_contract(
    env: &Env,
    asset: &Address,
    from: &Address,
    amount: i128,
) -> Result<(), ContractError> {
    let contract = env.current_contract_address();
    transfer_from_participant_to(env, asset, from, &contract, amount)
}

fn transfer_from_participant_to(
    env: &Env,
    asset: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) -> Result<(), ContractError> {
    let spender = env.current_contract_address();
    let token = token::TokenClient::new(env, asset);
    if token.allowance(from, &spender) < amount {
        return Err(ContractError::InsufficientAllowance);
    }
    token.transfer_from(&spender, from, to, &amount);
    Ok(())
}

fn transfer_from_contract_to_participant(env: &Env, asset: &Address, to: &Address, amount: i128) {
    let contract = env.current_contract_address();
    token::TokenClient::new(env, asset).transfer(&contract, to, &amount);
}

#[allow(deprecated)]
fn publish_transition(
    env: &Env,
    event_name: Symbol,
    asset: &Address,
    amount: i128,
    pool_id: u64,
    position_id: Address,
    actor: Address,
    reference: String,
    post_funded_units: u64,
    post_total_invested: i128,
    post_total_repaid: i128,
) {
    env.events().publish(
        (Symbol::new(env, "chainmove_pool_v1"), event_name),
        TransitionEvent {
            version: 1,
            asset: asset.clone(),
            amount,
            pool_id,
            position_id,
            actor,
            reference,
            post_funded_units,
            post_total_invested,
            post_total_repaid,
        },
    );
}

fn checked_add_i128(left: i128, right: i128) -> Result<i128, ContractError> {
    left.checked_add(right)
        .ok_or(ContractError::ArithmeticOverflow)
}

fn checked_sub_i128(left: i128, right: i128) -> Result<i128, ContractError> {
    left.checked_sub(right)
        .ok_or(ContractError::ArithmeticOverflow)
}

fn checked_add_u64(left: u64, right: u64) -> Result<u64, ContractError> {
    left.checked_add(right)
        .ok_or(ContractError::ArithmeticOverflow)
}

fn checked_sub_u64(left: u64, right: u64) -> Result<u64, ContractError> {
    left.checked_sub(right)
        .ok_or(ContractError::ArithmeticOverflow)
}

#[cfg(test)]
mod test;
