use anchor_lang::prelude::*;

use crate::{
  common::{constant, error::BentoError, event},
  states::Config,
};

#[derive(AnchorSerialize, AnchorDeserialize, Debug)]
pub struct UpdateConfigParams {
  pub relayer: Option<Pubkey>,
  pub relayer_encryption_key: Option<[u8; 32]>,
  pub escalate_threshold: Option<u32>,
  pub block_threshold: Option<u32>,
  pub max_strikes: Option<u8>,
  pub ema_alpha: Option<u16>,
  pub ema_scale: Option<u16>,
}

pub fn process(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
  let config = &mut ctx.accounts.config;

  if let Some(relayer) = params.relayer {
    config.relayer = relayer;
  }

  if let Some(relayer_encryption_key) = params.relayer_encryption_key {
    config.relayer_encryption_key = relayer_encryption_key;
  }

  if let Some(escalate_threshold) = params.escalate_threshold {
    config.escalate_threshold = escalate_threshold;
  }

  if let Some(block_threshold) = params.block_threshold {
    config.block_threshold = block_threshold;
  }

  if let Some(max_strikes) = params.max_strikes {
    config.max_strikes = max_strikes;
  }

  if let Some(ema_alpha) = params.ema_alpha {
    config.ema_alpha = ema_alpha;
  }

  if let Some(ema_scale) = params.ema_scale {
    config.ema_scale = ema_scale;
  }

  emit!(event::UpdateConfig {
    config: config.key(),
  });

  Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
  #[account(
    mut,
    constraint = operator.key() == config.operator.key() @ BentoError::InvalidOperator
  )]
  pub operator: Signer<'info>,

  #[account(
    mut,
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
