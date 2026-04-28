use anchor_lang::prelude::*;

use crate::common::{constant, error::BentoError};

pub const MAX_PAYLOAD: usize = 8192;

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ActionStatus {
  Initialization = 0,
  Pending = 1,
  Approved = 2,
  Escalated = 3,
  Blocked = 4,
  Rejected = 5,
}

impl From<u8> for ActionStatus {
  fn from(value: u8) -> Self {
    match value {
      0 => ActionStatus::Initialization,
      1 => ActionStatus::Pending,
      2 => ActionStatus::Approved,
      3 => ActionStatus::Escalated,
      4 => ActionStatus::Blocked,
      5 => ActionStatus::Rejected,
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
  pub reasoning_hash: [u8; 32],

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
    self.status = ActionStatus::Initialization.into();
    self.data_len = data_len;
    self.bump = bump;
  }

  pub fn must_be_in_status(&self, expected_status: ActionStatus) -> Result<()> {
    match expected_status {
      ActionStatus::Initialization => {
        if self.status != ActionStatus::Initialization.into() {
          return err!(BentoError::ActionIsNotInInitialState);
        }
      }
      ActionStatus::Pending => {
        if self.status != ActionStatus::Pending.into() {
          return err!(BentoError::ActionIsNotInPendingState);
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
