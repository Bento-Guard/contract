use anchor_lang::prelude::*;

use crate::common::{constant, error::BentoError};

#[derive(PartialEq, Copy, Clone)]
pub enum AgentStatus {
  Inactive = 0,
  Active = 1,
}

impl From<bool> for AgentStatus {
  fn from(value: bool) -> Self {
    if value {
      AgentStatus::Active
    } else {
      AgentStatus::Inactive
    }
  }
}

impl From<AgentStatus> for bool {
  fn from(value: AgentStatus) -> Self {
    value == AgentStatus::Active
  }
}

const MAX_ALLOWED_TARGETS: usize = 10;

#[account]
#[derive(InitSpace, Debug)]
pub struct Agent {
  pub agent_wallet: Pubkey,
  pub owner: Pubkey,

  // Policy
  pub spend_limit: u64,

  pub threat_score: u32,
  pub strikes: u8,

  pub allowed_targets: [AllowedTarget; MAX_ALLOWED_TARGETS],
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

#[derive(Debug, Clone, Copy, InitSpace, AnchorDeserialize, AnchorSerialize)]
pub struct AllowedTarget {
  pub target: Pubkey,
  pub allowed: bool,
}

impl Agent {
  pub fn space() -> usize {
    constant::DISCRIMINATOR + Agent::INIT_SPACE
  }

  pub fn init(&mut self, agent_wallet: Pubkey, owner: Pubkey, spend_limit: u64, bump: u8) {
    self.agent_wallet = agent_wallet;
    self.owner = owner;
    self.spend_limit = spend_limit;
    self.active = AgentStatus::Active.into();
    self.bump = bump;
  }

  pub fn find_mut_program_allowed_target(
    &mut self,
    program_target: Pubkey,
  ) -> Option<&mut AllowedTarget> {
    self
      .allowed_targets
      .iter_mut()
      .find(|allowed_target| allowed_target.target == program_target)
  }

  pub fn add_program_allowed_target(&mut self, program_target: Pubkey) -> Result<()> {
    if let Some(index) = self
      .allowed_targets
      .iter()
      .position(|allowed_target| allowed_target.target == Pubkey::default())
    {
      self.allowed_targets[index] = AllowedTarget {
        target: program_target,
        allowed: true,
      };

      Ok(())
    } else {
      err!(BentoError::AllowedTargetProgramReachedLimit)
    }
  }

  pub fn increase_action_counter(&mut self, current_action_id: u64) {
    if self.action_counter < current_action_id {
      self.action_counter = current_action_id;
    }
  }

  #[inline(always)]
  pub fn deactivate(&mut self) {
    self.active = AgentStatus::Inactive.into();
  }

  #[inline(always)]
  pub fn activate(&mut self) {
    self.active = AgentStatus::Active.into();
  }
}
