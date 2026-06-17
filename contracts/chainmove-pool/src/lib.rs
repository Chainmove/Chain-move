#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env,
};

#[contract]
pub struct ChainMovePoolContract;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PoolError {
    InvalidAmount = 1,
    PoolAlreadyExists = 2,
    PoolNotFound = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolData {
    pub owner: Address,
    pub target_amount: i128,
    pub invested_amount: i128,
    pub repaid_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvestorPosition {
    pub invested_amount: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Pool(u64),
    InvestorPosition(u64, Address),
}

#[contractimpl]
impl ChainMovePoolContract {
    /// PROTOTYPE/TESTNET ONLY: creates a local pool record without production auth checks.
    pub fn create_pool(env: Env, pool_id: u64, owner: Address, target_amount: i128) -> PoolData {
        require_positive_amount(&env, target_amount);

        let key = DataKey::Pool(pool_id);
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, PoolError::PoolAlreadyExists);
        }

        let pool = PoolData {
            owner,
            target_amount,
            invested_amount: 0,
            repaid_amount: 0,
        };

        env.storage().persistent().set(&key, &pool);
        pool
    }

    /// PROTOTYPE/TESTNET ONLY: records aggregate and investor-level investment amounts.
    pub fn record_investment(env: Env, pool_id: u64, investor: Address, amount: i128) -> PoolData {
        require_positive_amount(&env, amount);

        let mut pool = read_pool_or_panic(&env, pool_id);
        pool.invested_amount += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);

        let position_key = DataKey::InvestorPosition(pool_id, investor);
        let mut position = env
            .storage()
            .persistent()
            .get::<_, InvestorPosition>(&position_key)
            .unwrap_or(InvestorPosition { invested_amount: 0 });
        position.invested_amount += amount;
        env.storage().persistent().set(&position_key, &position);

        pool
    }

    /// PROTOTYPE/TESTNET ONLY: records repayment against a pool aggregate.
    pub fn record_repayment(env: Env, pool_id: u64, amount: i128) -> PoolData {
        require_positive_amount(&env, amount);

        let mut pool = read_pool_or_panic(&env, pool_id);
        pool.repaid_amount += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);

        pool
    }

    pub fn read_pool_data(env: Env, pool_id: u64) -> PoolData {
        read_pool_or_panic(&env, pool_id)
    }

    pub fn read_investor_position(env: Env, pool_id: u64, investor: Address) -> InvestorPosition {
        env.storage()
            .persistent()
            .get::<_, InvestorPosition>(&DataKey::InvestorPosition(pool_id, investor))
            .unwrap_or(InvestorPosition { invested_amount: 0 })
    }
}

fn require_positive_amount(env: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(env, PoolError::InvalidAmount);
    }
}

fn read_pool_or_panic(env: &Env, pool_id: u64) -> PoolData {
    env.storage()
        .persistent()
        .get::<_, PoolData>(&DataKey::Pool(pool_id))
        .unwrap_or_else(|| panic_with_error!(env, PoolError::PoolNotFound))
}

#[cfg(test)]
mod test;
