use anchor_lang::prelude::*;

use crate::common::constant;

pub const MAX_PAYLOAD: usize = 8192;

pub enum ActionStatus {
  PENDING = 0,
  APPROVED = 1,
  ESCALATED = 2,
  BLOCKED = 3,
  REJECTED = 4,
}

impl From<u8> for ActionStatus {
  fn from(value: u8) -> Self {
    match value {
      0 => ActionStatus::PENDING,
      1 => ActionStatus::APPROVED,
      2 => ActionStatus::ESCALATED,
      3 => ActionStatus::BLOCKED,
      4 => ActionStatus::REJECTED,
      _ => unreachable!(),
    }
  }
}

impl From<ActionStatus> for u8 {
  fn from(value: ActionStatus) -> Self {
    value as u8
  }
}

#[account(zero_copy)]
#[repr(C, packed)]
pub struct Action {
  pub agent: Pubkey,
  pub action_id: u64,

  pub target_program: Pubkey,
  pub value: u64,

  pub commitment: [u8; 32],

  pub data_len: u32,
  pub data_written: u32,

  pub status: u8,
  pub decision: u8,
  pub raw_score: u32,

  pub bump: u8,
  pub _padding: [u8; 7],

  // Encrypted payload (chunked writes)
  pub encrypted_payload: [u8; MAX_PAYLOAD], // 8192
}

impl Action {
  pub fn space() -> usize {
    constant::DISCRIMINATOR + std::mem::size_of::<Action>()
  }

  pub fn init(
    &mut self,
    agent: Pubkey,
    action_id: u64,
    target_program: Pubkey,
    value: u64,
    bump: u8,
  ) {
    self.agent = agent;
    self.action_id = action_id;
    self.target_program = target_program;
    self.value = value;
    self.status = ActionStatus::PENDING.into();
    self.bump = bump;
  }
}
