#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct RepaymentContract;

#[contractimpl]
impl RepaymentContract {
    pub fn initialize(env: Env, admin: Address) {
        // Fix for Issue 163: Require admin authorization
        admin.require_auth();
        env.storage().instance().set(&soroban_sdk::symbol_short!("ADMIN"), &admin);
    }
}
