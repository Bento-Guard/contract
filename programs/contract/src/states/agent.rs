use anchor_lang::prelude::*;

use crate::common::constant;

#[derive(PartialEq, Copy, Clone)]
enum Active {
  Inactive = 0,
  Active = 1,
}

impl From<bool> for Active {
  fn from(value: bool) -> Self {
    if value {
      Active::Active
    } else {
      Active::Inactive
    }
  }
}

impl From<Active> for bool {
  fn from(value: Active) -> Self {
    value == Active::Active
  }
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Agent {
  pub agent_wallet: Pubkey,
  pub owner: Pubkey,

  // Policy
  pub spend_limit: u64,

  pub threat_score: u32,
  pub strikes: u8,

  /**
   * 0: Inactive
   * 1: Active
   */
  pub active: bool,

  // Metadata
  pub registered_at: i64,
  pub action_counter: u64,
  pub total_actions: u64,
  pub total_approved: u64,
  pub total_blocked: u64,
  pub total_escalated: u64,

  pub bump: u8,
  pub _padding: [u64; 8],
}

impl<'info> Agent {
  pub fn space() -> usize {
    constant::DISCRIMINATOR + Agent::INIT_SPACE
  }

  pub fn init(&mut self, agent_wallet: Pubkey, owner: Pubkey, spend_limit: u64, bump: u8) {
    self.agent_wallet = agent_wallet;
    self.owner = owner;
    self.spend_limit = spend_limit;
    self.active = Active::Active.into();
    self.bump = bump;
  }
}
