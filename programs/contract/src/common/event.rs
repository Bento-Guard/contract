use anchor_lang::prelude::*;

#[event]
pub struct InitializeConfigEvent {
  pub owner: Pubkey,
}
