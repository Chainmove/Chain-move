extern crate std;

use super::{ChainMovePoolContract, ChainMovePoolContractClient, InvestorPosition, PoolData};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup() -> (Env, ChainMovePoolContractClient<'static>, Address, Address) {
    let env = Env::default();
    let contract_id = env.register(ChainMovePoolContract, ());
    let client = ChainMovePoolContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let investor = Address::generate(&env);

    (env, client, owner, investor)
}

#[test]
fn creates_a_pool() {
    let (_env, client, owner, _investor) = setup();

    let pool = client.create_pool(&1, &owner, &50_000);

    assert_eq!(
        pool,
        PoolData {
            owner,
            target_amount: 50_000,
            invested_amount: 0,
            repaid_amount: 0,
        }
    );
}

#[test]
fn records_an_investment_and_investor_position() {
    let (_env, client, owner, investor) = setup();

    client.create_pool(&1, &owner, &50_000);
    let pool = client.record_investment(&1, &investor, &12_500);
    let position = client.read_investor_position(&1, &investor);

    assert_eq!(pool.invested_amount, 12_500);
    assert_eq!(
        position,
        InvestorPosition {
            invested_amount: 12_500,
        }
    );
}

#[test]
fn records_a_repayment() {
    let (_env, client, owner, _investor) = setup();

    client.create_pool(&1, &owner, &50_000);
    let pool = client.record_repayment(&1, &7_000);

    assert_eq!(pool.repaid_amount, 7_000);
}

#[test]
fn reads_pool_state() {
    let (_env, client, owner, investor) = setup();

    client.create_pool(&1, &owner.clone(), &50_000);
    client.record_investment(&1, &investor, &15_000);
    client.record_repayment(&1, &5_000);

    assert_eq!(
        client.read_pool_data(&1),
        PoolData {
            owner,
            target_amount: 50_000,
            invested_amount: 15_000,
            repaid_amount: 5_000,
        }
    );
}

#[test]
fn rejects_invalid_input() {
    let (_env, client, owner, investor) = setup();

    let invalid_pool = client.try_create_pool(&1, &owner, &0);
    assert!(invalid_pool.is_err());

    client.create_pool(&1, &owner, &50_000);

    let invalid_investment = client.try_record_investment(&1, &investor, &-1);
    assert!(invalid_investment.is_err());

    let invalid_repayment = client.try_record_repayment(&1, &0);
    assert!(invalid_repayment.is_err());
}
