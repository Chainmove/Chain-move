//! Timelocked, quorum-approved WASM upgrade governance for the ChainMove
//! pool contract.
//!
//! No single signer can move the contract's active WASM. An upgrade must be
//! proposed by an approver, collect approvals from at least `quorum`
//! distinct approvers, and wait until a fixed timelock elapses before it can
//! be executed. Executing an upgrade also requires the proposal's declared
//! schema migration to be compatible with the currently persisted schema
//! version, so an incompatible migration can never activate new code
//! against old state.

use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

use crate::ContractError;

/// Static governance parameters, set once at bootstrap.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceConfig {
    pub approvers: Vec<Address>,
    pub quorum: u32,
    pub timelock_seconds: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ProposalStatus {
    Pending,
    Executed,
    Canceled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposal {
    pub id: u64,
    pub proposer: Address,
    pub new_wasm_hash: BytesN<32>,
    /// Schema version this proposal expects to be active when executed.
    /// Execution fails if the persisted schema version has moved on.
    pub current_schema_version: u32,
    /// Schema version the contract will report after this upgrade lands.
    /// Must be an explicit, forward migration step (`current + 1`) so a
    /// migration plan can never be skipped or applied out of order.
    pub new_schema_version: u32,
    /// Opaque commitment to the off-chain migration plan/runbook that must
    /// accompany this upgrade (e.g. a hash of the migration document).
    pub migration_plan_hash: BytesN<32>,
    pub proposed_at: u64,
    /// Earliest ledger timestamp at which this proposal may execute.
    pub eta: u64,
    pub approvals: Vec<Address>,
    pub status: ProposalStatus,
}

use crate::DataKey;

pub fn init_governance(
    env: &Env,
    admin: Address,
    approvers: Vec<Address>,
    quorum: u32,
    timelock_seconds: u64,
    initial_schema_version: u32,
) -> Result<GovernanceConfig, ContractError> {
    admin.require_auth();

    let config_key = DataKey::GovernanceConfig;
    if env.storage().instance().has(&config_key) {
        return Err(ContractError::GovernanceAlreadyInitialized);
    }

    if approvers.is_empty() || quorum == 0 || quorum > approvers.len() {
        return Err(ContractError::InvalidGovernanceConfig);
    }
    if has_duplicate_address(&approvers) {
        return Err(ContractError::InvalidGovernanceConfig);
    }

    let config = GovernanceConfig {
        approvers,
        quorum,
        timelock_seconds,
    };

    env.storage().instance().set(&config_key, &config);
    env.storage()
        .instance()
        .set(&DataKey::SchemaVersion, &initial_schema_version);
    env.storage()
        .instance()
        .set(&DataKey::NextProposalId, &1u64);

    Ok(config)
}

pub fn read_governance_config(env: &Env) -> Result<GovernanceConfig, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::GovernanceConfig)
        .ok_or(ContractError::GovernanceNotInitialized)
}

pub fn read_schema_version(env: &Env) -> Result<u32, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::SchemaVersion)
        .ok_or(ContractError::GovernanceNotInitialized)
}

pub fn read_upgrade_proposal(
    env: &Env,
    proposal_id: u64,
) -> Result<UpgradeProposal, ContractError> {
    let key = DataKey::UpgradeProposal(proposal_id);
    let proposal = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::ProposalNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, crate::RENT_THRESHOLD, crate::RENT_EXTEND_TO);
    Ok(proposal)
}

pub fn propose_upgrade(
    env: &Env,
    proposer: Address,
    new_wasm_hash: BytesN<32>,
    new_schema_version: u32,
    migration_plan_hash: BytesN<32>,
) -> Result<UpgradeProposal, ContractError> {
    proposer.require_auth();

    let config = read_governance_config(env)?;
    require_approver(&config, &proposer)?;

    let current_schema_version = read_schema_version(env)?;
    // Migrations must be explicit, sequential forward steps. This is the
    // guard that rejects an incompatible schema version before any WASM is
    // ever swapped in.
    if new_schema_version != current_schema_version + 1 {
        return Err(ContractError::IncompatibleSchemaVersion);
    }

    let now = env.ledger().timestamp();
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NextProposalId)
        .unwrap_or(1u64);

    let mut approvals: Vec<Address> = Vec::new(env);
    approvals.push_back(proposer.clone());

    let proposal = UpgradeProposal {
        id,
        proposer: proposer.clone(),
        new_wasm_hash,
        current_schema_version,
        new_schema_version,
        migration_plan_hash,
        proposed_at: now,
        eta: now + config.timelock_seconds,
        approvals,
        status: ProposalStatus::Pending,
    };

    let proposal_key = DataKey::UpgradeProposal(id);
    env.storage().persistent().set(&proposal_key, &proposal);
    env.storage().persistent().extend_ttl(
        &proposal_key,
        crate::RENT_THRESHOLD,
        crate::RENT_EXTEND_TO,
    );
    env.storage()
        .instance()
        .set(&DataKey::NextProposalId, &(id + 1));

    publish_governance_event(env, "gov_proposed_v1", &proposal);

    Ok(proposal)
}

pub fn approve_upgrade(
    env: &Env,
    approver: Address,
    proposal_id: u64,
) -> Result<UpgradeProposal, ContractError> {
    approver.require_auth();

    let config = read_governance_config(env)?;
    require_approver(&config, &approver)?;

    let mut proposal = read_upgrade_proposal(env, proposal_id)?;
    if proposal.status != ProposalStatus::Pending {
        return Err(ContractError::ProposalNotPending);
    }
    if proposal.approvals.contains(&approver) {
        return Err(ContractError::AlreadyApproved);
    }

    proposal.approvals.push_back(approver);
    let proposal_key = DataKey::UpgradeProposal(proposal_id);
    env.storage().persistent().set(&proposal_key, &proposal);
    env.storage().persistent().extend_ttl(
        &proposal_key,
        crate::RENT_THRESHOLD,
        crate::RENT_EXTEND_TO,
    );

    publish_governance_event(env, "gov_approved_v1", &proposal);

    Ok(proposal)
}

pub fn cancel_upgrade(
    env: &Env,
    canceler: Address,
    proposal_id: u64,
) -> Result<UpgradeProposal, ContractError> {
    canceler.require_auth();

    let config = read_governance_config(env)?;
    let mut proposal = read_upgrade_proposal(env, proposal_id)?;

    if proposal.status != ProposalStatus::Pending {
        return Err(ContractError::ProposalNotPending);
    }
    if canceler != proposal.proposer && !is_approver(&config, &canceler) {
        return Err(ContractError::NotAnApprover);
    }

    proposal.status = ProposalStatus::Canceled;
    let proposal_key = DataKey::UpgradeProposal(proposal_id);
    env.storage().persistent().set(&proposal_key, &proposal);
    env.storage().persistent().extend_ttl(
        &proposal_key,
        crate::RENT_THRESHOLD,
        crate::RENT_EXTEND_TO,
    );

    publish_governance_event(env, "gov_canceled_v1", &proposal);

    Ok(proposal)
}

pub fn execute_upgrade(
    env: &Env,
    executor: Address,
    proposal_id: u64,
) -> Result<UpgradeProposal, ContractError> {
    executor.require_auth();

    let config = read_governance_config(env)?;
    require_approver(&config, &executor)?;

    let mut proposal = read_upgrade_proposal(env, proposal_id)?;
    if proposal.status != ProposalStatus::Pending {
        return Err(ContractError::ProposalNotPending);
    }

    if (proposal.approvals.len() as u32) < config.quorum {
        return Err(ContractError::QuorumNotMet);
    }

    let now = env.ledger().timestamp();
    if now < proposal.eta {
        return Err(ContractError::TimelockNotElapsed);
    }

    // Defense in depth: re-check against the *current* persisted schema
    // version at execution time, not just at proposal time. If another
    // upgrade already executed and moved the schema version on, this
    // proposal is stale and must not activate its WASM against a state
    // shape it was never evaluated against.
    let current_schema_version = read_schema_version(env)?;
    if current_schema_version != proposal.current_schema_version {
        return Err(ContractError::StaleProposal);
    }

    env.deployer()
        .update_current_contract_wasm(proposal.new_wasm_hash.clone());

    env.storage()
        .instance()
        .set(&DataKey::SchemaVersion, &proposal.new_schema_version);

    proposal.status = ProposalStatus::Executed;
    let proposal_key = DataKey::UpgradeProposal(proposal_id);
    env.storage().persistent().set(&proposal_key, &proposal);
    env.storage().persistent().extend_ttl(
        &proposal_key,
        crate::RENT_THRESHOLD,
        crate::RENT_EXTEND_TO,
    );

    publish_governance_event(env, "gov_executed_v1", &proposal);

    Ok(proposal)
}

fn require_approver(config: &GovernanceConfig, address: &Address) -> Result<(), ContractError> {
    if is_approver(config, address) {
        Ok(())
    } else {
        Err(ContractError::NotAnApprover)
    }
}

fn is_approver(config: &GovernanceConfig, address: &Address) -> bool {
    config.approvers.contains(address)
}

fn has_duplicate_address(addresses: &Vec<Address>) -> bool {
    for i in 0..addresses.len() {
        let candidate = addresses.get(i).unwrap();
        for j in (i + 1)..addresses.len() {
            if addresses.get(j).unwrap() == candidate {
                return true;
            }
        }
    }
    false
}

#[allow(deprecated)]
fn publish_governance_event(env: &Env, event_name: &str, proposal: &UpgradeProposal) {
    env.events().publish(
        (
            soroban_sdk::Symbol::new(env, "chainmove_gov_v1"),
            soroban_sdk::Symbol::new(env, event_name),
        ),
        proposal.clone(),
    );
}
