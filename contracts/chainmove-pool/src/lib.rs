#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String};

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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pool {
    pub id: u64,
    pub owner: Address,
    pub asset_label: String,
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
    pub invested: i128,
    pub repaid: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Pool(u64),
    InvestorPosition(u64, Address),
}

#[contractimpl]
impl ChainMovePoolContract {
    pub fn create_pool(
        env: Env,
        owner: Address,
        pool_id: u64,
        asset_label: String,
        target_amount: i128,
    ) -> Result<Pool, ContractError> {
        owner.require_auth();

        if pool_id == 0 || target_amount <= 0 || asset_label.is_empty() {
            return Err(ContractError::InvalidInput);
        }

        let key = DataKey::Pool(pool_id);
        if env.storage().persistent().has(&key) {
            return Err(ContractError::PoolAlreadyExists);
        }

        let pool = Pool {
            id: pool_id,
            owner,
            asset_label,
            target_amount,
            total_invested: 0,
            total_repaid: 0,
            active: true,
        };

        env.storage().persistent().set(&key, &pool);

        Ok(pool)
    }

    pub fn record_investment(
        env: Env,
        investor: Address,
        pool_id: u64,
        amount: i128,
    ) -> Result<InvestorPosition, ContractError> {
        investor.require_auth();

        if pool_id == 0 || amount <= 0 {
            return Err(ContractError::InvalidInput);
        }

        let pool_key = DataKey::Pool(pool_id);
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&pool_key)
            .ok_or(ContractError::PoolNotFound)?;

        pool.total_invested += amount;
        env.storage().persistent().set(&pool_key, &pool);

        let position_key = DataKey::InvestorPosition(pool_id, investor.clone());
        let mut position = env
            .storage()
            .persistent()
            .get(&position_key)
            .unwrap_or(InvestorPosition {
                pool_id,
                investor,
                invested: 0,
                repaid: 0,
            });

        position.invested += amount;
        env.storage().persistent().set(&position_key, &position);

        Ok(position)
    }

    pub fn record_repayment(
        env: Env,
        payer: Address,
        pool_id: u64,
        investor: Address,
        amount: i128,
    ) -> Result<InvestorPosition, ContractError> {
        payer.require_auth();

        if pool_id == 0 || amount <= 0 {
            return Err(ContractError::InvalidInput);
        }

        let pool_key = DataKey::Pool(pool_id);
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&pool_key)
            .ok_or(ContractError::PoolNotFound)?;

        let position_key = DataKey::InvestorPosition(pool_id, investor);
        let mut position: InvestorPosition = env
            .storage()
            .persistent()
            .get(&position_key)
            .ok_or(ContractError::InvestorPositionNotFound)?;

        pool.total_repaid += amount;
        position.repaid += amount;

        env.storage().persistent().set(&pool_key, &pool);
        env.storage().persistent().set(&position_key, &position);

        Ok(position)
    }

    pub fn read_pool(env: Env, pool_id: u64) -> Result<Pool, ContractError> {
        if pool_id == 0 {
            return Err(ContractError::InvalidInput);
        }

        env.storage()
            .persistent()
            .get(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)
    }

    pub fn read_investor_position(
        env: Env,
        investor: Address,
        pool_id: u64,
    ) -> Result<InvestorPosition, ContractError> {
        if pool_id == 0 {
            return Err(ContractError::InvalidInput);
        }

        env.storage()
            .persistent()
            .get(&DataKey::InvestorPosition(pool_id, investor))
            .ok_or(ContractError::InvestorPositionNotFound)
    }
}

#[cfg(test)]
mod test;

