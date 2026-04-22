use anchor_lang::prelude::*;

#[event]
pub struct InitializeConfig {
  pub config: Pubkey,
}
