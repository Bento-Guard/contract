use anchor_lang::prelude::*;

use crate::{common::error::BentoError, constant, states::ActionStatus};

#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
  // Authority
  pub operator: Pubkey,
  pub relayer: Pubkey,
  pub relayer_encryption_key: [u8; 32],

  // Policy threshold
  pub escalate_threshold: u32,
  pub block_threshold: u32,
  pub max_strikes: u8,

  // EMA parameters
  pub ema_alpha: u16,
  pub ema_scale: u16,

  pub total_agents: u64,

  pub bump: u8,
  pub maintenance: bool,
  pub _padding: [u64; 8],
}

impl Config {
  pub fn space() -> usize {
    constant::DISCRIMINATOR + Config::INIT_SPACE
  }

  #[allow(clippy::too_many_arguments)]
  pub fn init(
    &mut self,
    operator: Pubkey,
    relayer: Pubkey,
    relayer_encryption_key: [u8; 32],
    escalate_threshold: u32,
    block_threshold: u32,
    max_strikes: u8,
    ema_alpha: u16,
    ema_scale: u16,
    bump: u8,
  ) {
    self.operator = operator;
    self.relayer = relayer;
    self.relayer_encryption_key = relayer_encryption_key;
    self.escalate_threshold = escalate_threshold;
    self.block_threshold = block_threshold;
    self.max_strikes = max_strikes;
    self.ema_alpha = ema_alpha;
    self.ema_scale = ema_scale;
    self.total_agents = 0;
    self.bump = bump;
  }

  pub fn increment_agents(&mut self) {
    self.total_agents += 1;
  }

  pub fn is_in_maintenance(&self) -> Result<()> {
    if self.maintenance {
      return err!(BentoError::BentoIsInMaintenance);
    }

    Ok(())
  }

  pub fn decision_for(&self, raw_score: u32) -> ActionStatus {
    if raw_score >= self.block_threshold {
      ActionStatus::Blocked
    } else if raw_score >= self.escalate_threshold {
      ActionStatus::Escalated
    } else {
      ActionStatus::Approved
    }
  }
}
