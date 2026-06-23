extern crate std;

use super::{ChainMovePoolContract, ChainMovePoolContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn create_client(env: &Env) -> ChainMovePoolContractClient<'_> {
    let contract_id = env.register(ChainMovePoolContract, ());
    ChainMovePoolContractClient::new(env, &contract_id)
}

fn setup_pool(env: &Env, client: &ChainMovePoolContractClient<'_>) -> (Address, Address) {
    let owner = Address::generate(env);
    let investor = Address::generate(env);
    let asset_label = String::from_str(env, "testnet-van-01");

    let pool = client
        .try_create_pool(&owner, &1, &asset_label, &100, &10_000)
        .unwrap()
        .unwrap();

    assert_eq!(pool.id, 1);
    assert_eq!(pool.owner, owner);
    assert_eq!(pool.asset_label, asset_label);
    assert_eq!(pool.total_units, 100);
    assert_eq!(pool.target_amount, 10_000);
    assert_eq!(pool.total_invested, 0);
    assert_eq!(pool.total_repaid, 0);
    assert!(pool.active);

    (owner, investor)
}

#[test]
fn creates_pool_and_reads_pool_data() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);

    let (owner, _) = setup_pool(&env, &client);
    let pool = client.try_read_pool(&1).unwrap().unwrap();

    assert_eq!(pool.id, 1);
    assert_eq!(pool.owner, owner);
    assert_eq!(pool.total_units, 100);
    assert_eq!(pool.total_invested, 0);
    assert_eq!(pool.total_repaid, 0);
}

#[test]
fn records_investment_and_reads_investor_position() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);
    let (_, investor) = setup_pool(&env, &client);

    let position = client
        .try_record_investment(&investor, &1, &2_500)
        .unwrap()
        .unwrap();
    let pool = client.try_read_pool(&1).unwrap().unwrap();
    let stored_position = client
        .try_read_investor_position(&investor, &1)
        .unwrap()
        .unwrap();

    assert_eq!(position.pool_id, 1);
    assert_eq!(position.investor, investor);
    assert_eq!(position.invested, 2_500);
    assert_eq!(position.repaid, 0);
    assert_eq!(stored_position, position);
    assert_eq!(pool.total_invested, 2_500);
}

#[test]
fn records_repayment_against_pool_and_position() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);
    let (owner, investor) = setup_pool(&env, &client);

    client
        .try_record_investment(&investor, &1, &3_000)
        .unwrap()
        .unwrap();

    let position = client
        .try_record_repayment(&owner, &1, &investor, &1_100)
        .unwrap()
        .unwrap();
    let pool = client.try_read_pool(&1).unwrap().unwrap();

    assert_eq!(position.invested, 3_000);
    assert_eq!(position.repaid, 1_100);
    assert_eq!(pool.total_invested, 3_000);
    assert_eq!(pool.total_repaid, 1_100);
}

#[test]
fn rejects_invalid_input() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);
    let owner = Address::generate(&env);
    let investor = Address::generate(&env);
    let asset_label = String::from_str(&env, "testnet-van-01");

    // pool_id = 0 is invalid
    let invalid_pool = client.try_create_pool(&owner, &0, &asset_label, &100, &10_000);
    assert!(invalid_pool.is_err());

    // total_units = 0 is invalid
    let invalid_units = client.try_create_pool(&owner, &1, &asset_label, &0, &10_000);
    assert!(invalid_units.is_err());

    client
        .try_create_pool(&owner, &1, &asset_label, &100, &10_000)
        .unwrap()
        .unwrap();

    // amount = 0 is invalid
    let invalid_investment = client.try_record_investment(&investor, &1, &0);
    assert!(invalid_investment.is_err());

    let missing_position_repayment = client.try_record_repayment(&owner, &1, &investor, &100);
    assert!(missing_position_repayment.is_err());
}

#[test]
fn rejects_oversubscription() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);
    let (_, investor) = setup_pool(&env, &client);

    // invest 8_000 of 10_000 target — succeeds
    client
        .try_record_investment(&investor, &1, &8_000)
        .unwrap()
        .unwrap();

    // attempt to invest 3_000 more would exceed target_amount — must fail
    let oversubscribed = client.try_record_investment(&investor, &1, &3_000);
    assert!(oversubscribed.is_err());

    // investing exactly the remaining 2_000 — succeeds
    client
        .try_record_investment(&investor, &1, &2_000)
        .unwrap()
        .unwrap();

    let pool = client.try_read_pool(&1).unwrap().unwrap();
    assert_eq!(pool.total_invested, 10_000);
}

#[test]
fn updates_duplicate_investor_position() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);
    let (_, investor) = setup_pool(&env, &client);

    // first investment
    client
        .try_record_investment(&investor, &1, &1_000)
        .unwrap()
        .unwrap();

    // second investment by same investor — should accumulate
    let position = client
        .try_record_investment(&investor, &1, &500)
        .unwrap()
        .unwrap();

    assert_eq!(position.invested, 1_500);

    let pool = client.try_read_pool(&1).unwrap().unwrap();
    assert_eq!(pool.total_invested, 1_500);
}

#[test]
fn calculates_investor_share_in_bps() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);
    let (_, investor) = setup_pool(&env, &client);

    // invest 2_500 out of 10_000 target => 25% => 2500 bps
    client
        .try_record_investment(&investor, &1, &2_500)
        .unwrap()
        .unwrap();

    let share_bps = client
        .try_get_investor_share(&investor, &1)
        .unwrap()
        .unwrap();

    assert_eq!(share_bps, 2_500);
}

#[test]
fn rejects_investment_into_closed_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);
    let (owner, investor) = setup_pool(&env, &client);

    client.try_close_pool(&owner, &1).unwrap().unwrap();

    let result = client.try_record_investment(&investor, &1, &1_000);
    assert!(result.is_err());
}
