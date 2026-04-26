use anchor_lang::prelude::*;

use crate::common::{constant, error::BentoError};

pub const MAX_PAYLOAD: usize = 8192;

pub enum ActionStatus {
  INITIALIZATION = 0,
  PENDING = 1,
  APPROVED = 2,
  ESCALATED = 3,
  BLOCKED = 4,
  REJECTED = 5,
}

impl From<u8> for ActionStatus {
  fn from(value: u8) -> Self {
    match value {
      0 => ActionStatus::INITIALIZATION,
      1 => ActionStatus::PENDING,
      2 => ActionStatus::APPROVED,
      3 => ActionStatus::ESCALATED,
      4 => ActionStatus::BLOCKED,
      5 => ActionStatus::REJECTED,
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
    data_len: u32,
    bump: u8,
  ) {
    self.agent = agent;
    self.action_id = action_id;
    self.target_program = target_program;
    self.value = value;
    self.status = ActionStatus::INITIALIZATION.into();
    self.data_len = data_len;
    self.bump = bump;
  }

  pub fn must_be_in_status(&self, expected_status: ActionStatus) -> Result<()> {
    match expected_status {
      ActionStatus::INITIALIZATION => {
        if self.status != ActionStatus::INITIALIZATION.into() {
          return err!(BentoError::ActionIsNotInInitialState);
        }
      }
      _ => {}
    }

    Ok(())
  }

  #[inline(always)]
  pub fn move_to_status(&mut self, new_status: ActionStatus) {
    self.status = new_status.into();
  }

  #[inline(always)]
  pub fn must_belong_to_agent(&self, agent: Pubkey) -> Result<()> {
    require!(self.agent == agent, BentoError::ActionDoesNotBelongToAgent);
    Ok(())
  }
}
