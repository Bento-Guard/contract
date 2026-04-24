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
