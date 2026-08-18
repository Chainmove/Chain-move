#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, String, Symbol};

#[contract]
pub struct ChainmovePoolContract;

#[contractimpl]
impl ChainmovePoolContract {
    // Fix for Issue 163: Authenticated bootstrap/factory authority for initialization
    pub fn initialize(env: Env, factory: Address) {
        factory.require_auth();
        env.storage().instance().set(&soroban_sdk::symbol_short!("FACTORY"), &factory);
    }

    pub fn create_pool(env: Env, factory: Address, pool_id: u32) {
        factory.require_auth();
        let expected_factory: Address = env.storage().instance().get(&soroban_sdk::symbol_short!("FACTORY")).unwrap();
        assert!(factory == expected_factory, "unauthorized factory");
        env.storage().persistent().set(&pool_id, &true);
    }

    // Fix for Issue 179: Pure read methods without TTL extension
    pub fn read_pool(env: Env, pool_id: u32) -> bool {
        // Pure read: no storage TTL extension
        env.storage().persistent().get(&pool_id).unwrap_or(false)
    }

    pub fn keepalive(env: Env, admin: Address, pool_id: u32) {
        admin.require_auth();
        env.storage().persistent().extend_ttl(&pool_id, 1000, 10000);
    }

    // Fix for Issue 169: Bound contract strings
    pub fn fund(env: Env, asset_label: String, reference: String) {
        // Enforce maximum length to prevent excessive storage costs
        assert!(asset_label.len() <= 32, "asset_label too long");
        assert!(reference.len() <= 64, "reference too long");
        
        env.storage().instance().set(&soroban_sdk::symbol_short!("LATEST"), &reference);
    }
}
