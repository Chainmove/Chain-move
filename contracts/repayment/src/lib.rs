#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env,
};

#[contract]
pub struct RepaymentContract;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepaymentState {
    pub pool_or_vehicle: Address,
    pub total_owed: i128,
    pub total_repaid: i128,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepaymentSummary {
    pub pool_or_vehicle: Address,
    pub total_owed: i128,
    pub total_repaid: i128,
    pub outstanding_balance: i128,
    pub overpaid_amount: i128,
    pub active: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    DriverState(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    NoActiveContract = 4,
    InvalidAmount = 5,
}

#[contractimpl]
impl RepaymentContract {
    /// Initialize the contract and set the administrator.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Admin assigns a driver to a pool or vehicle with a specified total owed amount.
    pub fn assign_driver(
        env: Env,
        driver: Address,
        pool_or_vehicle: Address,
        total_owed: i128,
    ) -> Result<(), Error> {
        let admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        
        admin.require_auth();

        if total_owed <= 0 {
            return Err(Error::InvalidAmount);
        }

        let state = RepaymentState {
            pool_or_vehicle,
            total_owed,
            total_repaid: 0,
            active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::DriverState(driver), &state);

        Ok(())
    }

    /// Record a repayment amount for an active driver contract.
    /// Caller must be either the admin or the driver themselves.
    pub fn record_repayment(
        env: Env,
        caller: Address,
        driver: Address,
        amount: i128,
    ) -> Result<RepaymentSummary, Error> {
        caller.require_auth();

        let admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        if caller != admin && caller != driver {
            return Err(Error::Unauthorized);
        }

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let key = DataKey::DriverState(driver.clone());
        let mut state = env
            .storage()
            .persistent()
            .get::<DataKey, RepaymentState>(&key)
            .ok_or(Error::NoActiveContract)?;

        if !state.active {
            return Err(Error::NoActiveContract);
        }

        state.total_repaid += amount;

        env.storage().persistent().set(&key, &state);

        // Compute dynamic summary
        let outstanding_balance = if state.total_repaid >= state.total_owed {
            0
        } else {
            state.total_owed - state.total_repaid
        };

        let overpaid_amount = if state.total_repaid > state.total_owed {
            state.total_repaid - state.total_owed
        } else {
            0
        };

        Ok(RepaymentSummary {
            pool_or_vehicle: state.pool_or_vehicle,
            total_owed: state.total_owed,
            total_repaid: state.total_repaid,
            outstanding_balance,
            overpaid_amount,
            active: state.active,
        })
    }

    /// Query the current repayment summary for a driver.
    pub fn get_summary(env: Env, driver: Address) -> Result<RepaymentSummary, Error> {
        let key = DataKey::DriverState(driver);
        let state = env
            .storage()
            .persistent()
            .get::<DataKey, RepaymentState>(&key)
            .ok_or(Error::NoActiveContract)?;

        let outstanding_balance = if state.total_repaid >= state.total_owed {
            0
        } else {
            state.total_owed - state.total_repaid
        };

        let overpaid_amount = if state.total_repaid > state.total_owed {
            state.total_repaid - state.total_owed
        } else {
            0
        };

        Ok(RepaymentSummary {
            pool_or_vehicle: state.pool_or_vehicle,
            total_owed: state.total_owed,
            total_repaid: state.total_repaid,
            outstanding_balance,
            overpaid_amount,
            active: state.active,
        })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_initialization_and_assignment() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(RepaymentContract, ());
        let client = RepaymentContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let driver = Address::generate(&env);
        let vehicle = Address::generate(&env);

        client.initialize(&admin);

        // Assign driver
        client.assign_driver(&driver, &vehicle, &1000);

        // Verify assignment
        let summary = client.get_summary(&driver);
        assert_eq!(summary.pool_or_vehicle, vehicle);
        assert_eq!(summary.total_owed, 1000);
        assert_eq!(summary.total_repaid, 0);
        assert_eq!(summary.outstanding_balance, 1000);
        assert_eq!(summary.overpaid_amount, 0);
        assert!(summary.active);
    }

    #[test]
    fn test_repayments() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(RepaymentContract, ());
        let client = RepaymentContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let driver = Address::generate(&env);
        let vehicle = Address::generate(&env);

        client.initialize(&admin);
        client.assign_driver(&driver, &vehicle, &1000);

        // First repayment
        let summary = client.record_repayment(&driver, &driver, &300);
        assert_eq!(summary.total_repaid, 300);
        assert_eq!(summary.outstanding_balance, 700);

        // Multiple repayments
        let summary = client.record_repayment(&driver, &driver, &400);
        assert_eq!(summary.total_repaid, 700);
        assert_eq!(summary.outstanding_balance, 300);

        // Full repayment
        let summary = client.record_repayment(&driver, &driver, &300);
        assert_eq!(summary.total_repaid, 1000);
        assert_eq!(summary.outstanding_balance, 0);
        assert_eq!(summary.overpaid_amount, 0);
    }

    #[test]
    fn test_overpayment_behavior() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(RepaymentContract, ());
        let client = RepaymentContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let driver = Address::generate(&env);
        let vehicle = Address::generate(&env);

        client.initialize(&admin);
        client.assign_driver(&driver, &vehicle, &1000);

        // Record overpayment
        let summary = client.record_repayment(&driver, &driver, &1200);
        assert_eq!(summary.total_repaid, 1200);
        assert_eq!(summary.outstanding_balance, 0);
        assert_eq!(summary.overpaid_amount, 200);
    }

    #[test]
    #[should_panic]
    fn test_unauthorized_repayment_fails() {
        let env = Env::default();
        let contract_id = env.register(RepaymentContract, ());
        let client = RepaymentContractClient::new(&env, &contract_id);

        let driver = Address::generate(&env);

        // Calling record_repayment without mock_all_auths will panic on driver.require_auth()
        let _ = client.record_repayment(&driver, &driver, &100);
    }

    #[test]
    #[should_panic]
    fn test_unauthorized_assignment_fails() {
        let env = Env::default();
        let contract_id = env.register(RepaymentContract, ());
        let client = RepaymentContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let driver = Address::generate(&env);
        let vehicle = Address::generate(&env);

        client.initialize(&admin);

        // Attacker attempts to assign driver (no mock_all_auths, will fail admin auth verify)
        client.assign_driver(&driver, &vehicle, &1000);
    }

    #[test]
    fn test_unauthorized_caller_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(RepaymentContract, ());
        let client = RepaymentContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let driver = Address::generate(&env);
        let vehicle = Address::generate(&env);
        let attacker = Address::generate(&env);

        client.initialize(&admin);
        client.assign_driver(&driver, &vehicle, &1000);

        // Attacker attempts to record repayment for driver (mock_all_auths is enabled so require_auth passes,
        // but contract logic rejects caller because caller != admin && caller != driver)
        let result = client.try_record_repayment(&attacker, &driver, &200);
        assert_eq!(result.unwrap_err().unwrap(), Error::Unauthorized);
    }
}
