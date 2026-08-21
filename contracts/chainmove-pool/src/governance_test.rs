extern crate std;

use super::{ChainMovePoolContract, ChainMovePoolContractClient, ContractError, DataKey};
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, BytesN, Env, Vec};

struct GovFixture {
    env: Env,
    contract_id: Address,
    admin: Address,
    approver_a: Address,
    approver_b: Address,
    approver_c: Address,
    non_approver: Address,
}

const TIMELOCK_SECONDS: u64 = 172_800; // 48h
const QUORUM: u32 = 2;

fn create_fixture() -> GovFixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(ChainMovePoolContract, ());
    let admin = Address::generate(&env);
    let approver_a = Address::generate(&env);
    let approver_b = Address::generate(&env);
    let approver_c = Address::generate(&env);
    let non_approver = Address::generate(&env);

    GovFixture {
        env,
        contract_id,
        admin,
        approver_a,
        approver_b,
        approver_c,
        non_approver,
    }
}

fn client(fixture: &GovFixture) -> ChainMovePoolContractClient<'_> {
    ChainMovePoolContractClient::new(&fixture.env, &fixture.contract_id)
}

fn approvers(fixture: &GovFixture) -> Vec<Address> {
    let mut v = Vec::new(&fixture.env);
    v.push_back(fixture.approver_a.clone());
    v.push_back(fixture.approver_b.clone());
    v.push_back(fixture.approver_c.clone());
    v
}

fn init_gov(fixture: &GovFixture) {
    client(fixture)
        .try_init_governance(
            &fixture.admin,
            &approvers(fixture),
            &QUORUM,
            &TIMELOCK_SECONDS,
            &1u32,
        )
        .unwrap()
        .unwrap();
}

fn wasm_hash(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

#[test]
fn init_governance_rejects_reinitialization() {
    let fixture = create_fixture();
    init_gov(&fixture);

    let result = client(&fixture).try_init_governance(
        &fixture.admin,
        &approvers(&fixture),
        &QUORUM,
        &TIMELOCK_SECONDS,
        &1u32,
    );

    assert_eq!(result, Err(Ok(ContractError::GovernanceAlreadyInitialized)));
}

#[test]
fn init_governance_rejects_invalid_quorum_configurations() {
    let fixture = create_fixture();

    // Quorum greater than the number of approvers.
    let result = client(&fixture).try_init_governance(
        &fixture.admin,
        &approvers(&fixture),
        &10u32,
        &TIMELOCK_SECONDS,
        &1u32,
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidGovernanceConfig)));

    // Zero quorum.
    let result = client(&fixture).try_init_governance(
        &fixture.admin,
        &approvers(&fixture),
        &0u32,
        &TIMELOCK_SECONDS,
        &1u32,
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidGovernanceConfig)));

    // Duplicate approver addresses.
    let mut dup = Vec::new(&fixture.env);
    dup.push_back(fixture.approver_a.clone());
    dup.push_back(fixture.approver_a.clone());
    let result =
        client(&fixture).try_init_governance(&fixture.admin, &dup, &1u32, &TIMELOCK_SECONDS, &1u32);
    assert_eq!(result, Err(Ok(ContractError::InvalidGovernanceConfig)));
}

#[test]
fn only_an_approver_can_propose_an_upgrade() {
    let fixture = create_fixture();
    init_gov(&fixture);

    let result = client(&fixture).try_propose_upgrade(
        &fixture.non_approver,
        &wasm_hash(&fixture.env, 1),
        &2u32,
        &wasm_hash(&fixture.env, 9),
    );

    assert_eq!(result, Err(Ok(ContractError::NotAnApprover)));
}

#[test]
fn propose_upgrade_requires_the_next_sequential_schema_version() {
    let fixture = create_fixture();
    init_gov(&fixture);

    // Skipping a version is rejected.
    let result = client(&fixture).try_propose_upgrade(
        &fixture.approver_a,
        &wasm_hash(&fixture.env, 1),
        &3u32,
        &wasm_hash(&fixture.env, 9),
    );
    assert_eq!(result, Err(Ok(ContractError::IncompatibleSchemaVersion)));

    // Repeating the current version is rejected.
    let result = client(&fixture).try_propose_upgrade(
        &fixture.approver_a,
        &wasm_hash(&fixture.env, 1),
        &1u32,
        &wasm_hash(&fixture.env, 9),
    );
    assert_eq!(result, Err(Ok(ContractError::IncompatibleSchemaVersion)));

    // Exactly current + 1 succeeds and auto-approves the proposer.
    let proposal = client(&fixture)
        .try_propose_upgrade(
            &fixture.approver_a,
            &wasm_hash(&fixture.env, 1),
            &2u32,
            &wasm_hash(&fixture.env, 9),
        )
        .unwrap()
        .unwrap();

    assert_eq!(proposal.approvals.len(), 1);
    assert_eq!(proposal.eta, proposal.proposed_at + TIMELOCK_SECONDS);
}

#[test]
fn approve_upgrade_rejects_non_approvers_and_double_approval() {
    let fixture = create_fixture();
    init_gov(&fixture);

    let proposal = client(&fixture)
        .try_propose_upgrade(
            &fixture.approver_a,
            &wasm_hash(&fixture.env, 1),
            &2u32,
            &wasm_hash(&fixture.env, 9),
        )
        .unwrap()
        .unwrap();

    let non_approver_result =
        client(&fixture).try_approve_upgrade(&fixture.non_approver, &proposal.id);
    assert_eq!(non_approver_result, Err(Ok(ContractError::NotAnApprover)));

    let double_approval_result =
        client(&fixture).try_approve_upgrade(&fixture.approver_a, &proposal.id);
    assert_eq!(
        double_approval_result,
        Err(Ok(ContractError::AlreadyApproved))
    );

    let approved = client(&fixture)
        .try_approve_upgrade(&fixture.approver_b, &proposal.id)
        .unwrap()
        .unwrap();
    assert_eq!(approved.approvals.len(), 2);
}

#[test]
fn execute_upgrade_requires_quorum_before_touching_wasm() {
    let fixture = create_fixture();
    init_gov(&fixture);

    let proposal = client(&fixture)
        .try_propose_upgrade(
            &fixture.approver_a,
            &wasm_hash(&fixture.env, 1),
            &2u32,
            &wasm_hash(&fixture.env, 9),
        )
        .unwrap()
        .unwrap();

    fixture
        .env
        .ledger()
        .set_timestamp(fixture.env.ledger().timestamp() + TIMELOCK_SECONDS + 1);

    // Only one approval (the proposer's) exists; quorum is 2.
    let result = client(&fixture).try_execute_upgrade(&fixture.approver_a, &proposal.id);
    assert_eq!(result, Err(Ok(ContractError::QuorumNotMet)));
}

#[test]
fn execute_upgrade_requires_timelock_to_elapse_even_with_quorum() {
    let fixture = create_fixture();
    init_gov(&fixture);

    let proposal = client(&fixture)
        .try_propose_upgrade(
            &fixture.approver_a,
            &wasm_hash(&fixture.env, 1),
            &2u32,
            &wasm_hash(&fixture.env, 9),
        )
        .unwrap()
        .unwrap();

    client(&fixture)
        .try_approve_upgrade(&fixture.approver_b, &proposal.id)
        .unwrap()
        .unwrap();

    // Quorum (2) is met, but the timelock has not elapsed.
    let result = client(&fixture).try_execute_upgrade(&fixture.approver_a, &proposal.id);
    assert_eq!(result, Err(Ok(ContractError::TimelockNotElapsed)));
}

#[test]
fn execute_upgrade_rejects_a_stale_proposal_when_schema_version_moved_on() {
    let fixture = create_fixture();
    init_gov(&fixture);

    let proposal = client(&fixture)
        .try_propose_upgrade(
            &fixture.approver_a,
            &wasm_hash(&fixture.env, 1),
            &2u32,
            &wasm_hash(&fixture.env, 9),
        )
        .unwrap()
        .unwrap();

    client(&fixture)
        .try_approve_upgrade(&fixture.approver_b, &proposal.id)
        .unwrap()
        .unwrap();

    fixture
        .env
        .ledger()
        .set_timestamp(fixture.env.ledger().timestamp() + TIMELOCK_SECONDS + 1);

    // Simulate a different upgrade having already executed and advanced the
    // persisted schema version out from under this proposal.
    fixture.env.as_contract(&fixture.contract_id, || {
        fixture
            .env
            .storage()
            .instance()
            .set(&DataKey::SchemaVersion, &5u32);
    });

    let result = client(&fixture).try_execute_upgrade(&fixture.approver_a, &proposal.id);
    assert_eq!(result, Err(Ok(ContractError::StaleProposal)));
}

#[test]
fn cancel_upgrade_allows_proposer_or_approver_but_not_outsiders() {
    let fixture = create_fixture();
    init_gov(&fixture);

    let proposal = client(&fixture)
        .try_propose_upgrade(
            &fixture.approver_a,
            &wasm_hash(&fixture.env, 1),
            &2u32,
            &wasm_hash(&fixture.env, 9),
        )
        .unwrap()
        .unwrap();

    let outsider_result = client(&fixture).try_cancel_upgrade(&fixture.non_approver, &proposal.id);
    assert_eq!(outsider_result, Err(Ok(ContractError::NotAnApprover)));

    let canceled = client(&fixture)
        .try_cancel_upgrade(&fixture.approver_b, &proposal.id)
        .unwrap()
        .unwrap();
    assert_eq!(canceled.status, super::ProposalStatus::Canceled);

    // A canceled proposal cannot be approved, executed, or canceled again
    // (no replay of a dead proposal).
    let reapprove = client(&fixture).try_approve_upgrade(&fixture.approver_c, &proposal.id);
    assert_eq!(reapprove, Err(Ok(ContractError::ProposalNotPending)));

    let reexecute = client(&fixture).try_execute_upgrade(&fixture.approver_a, &proposal.id);
    assert_eq!(reexecute, Err(Ok(ContractError::ProposalNotPending)));

    let recancel = client(&fixture).try_cancel_upgrade(&fixture.approver_a, &proposal.id);
    assert_eq!(recancel, Err(Ok(ContractError::ProposalNotPending)));
}

#[test]
fn governance_actions_before_bootstrap_fail_closed() {
    let fixture = create_fixture();

    let result = client(&fixture).try_propose_upgrade(
        &fixture.approver_a,
        &wasm_hash(&fixture.env, 1),
        &2u32,
        &wasm_hash(&fixture.env, 9),
    );
    assert_eq!(result, Err(Ok(ContractError::GovernanceNotInitialized)));
}
