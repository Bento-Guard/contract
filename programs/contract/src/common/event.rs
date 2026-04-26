use anchor_lang::prelude::*;

#[event]
pub struct InitializeConfig {
  pub config: Pubkey,
}

#[event]
pub struct UpdateConfig {
  pub config: Pubkey,
}

#[event]
pub struct RegisterAgent {
  pub agent_wallet: Pubkey,
  pub owner: Pubkey,
}

#[event]
pub struct DeactivateAgent {
  pub agent: Pubkey,
}

#[event]
pub struct ActiveAgent {
  pub agent: Pubkey,
}

#[event]
pub struct InitAction {
  pub action_id: u64,
  pub target_program: Pubkey,
  pub value: u64,
  pub agent: Pubkey,
}

#[event]
pub struct ActionSubmitted {
  pub action_id: u64,
  pub agent: Pubkey,
}
