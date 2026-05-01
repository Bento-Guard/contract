use anchor_lang::prelude::*;

use crate::{
  common::{error::BentoError, event, operator::OPERATOR_PUBKEY, PREFIX_SEED},
  Config,
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitializeConfigParams {
  pub relayer: Pubkey,
  pub relayer_encryption_key: [u8; 32],
  pub escalate_threshold: u32,
  pub block_threshold: u32,
  pub max_strikes: u8,
  pub ema_alpha: u16,
  pub ema_scale: u16,
}

pub fn process(ctx: Context<InitializeConfig>, params: InitializeConfigParams) -> Result<()> {
  let config = &mut ctx.accounts.config;

  config.init(
    ctx.accounts.operator.key(),
    params.relayer.key(),
    params.relayer_encryption_key,
    params.escalate_threshold,
    params.block_threshold,
    params.max_strikes,
    params.ema_alpha,
    params.ema_scale,
    ctx.bumps.config,
  );

  emit!(event::InitializeConfig {
    config: config.key(),
  });

  Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
  #[account(
    mut,
    constraint = operator.key() == OPERATOR_PUBKEY @ BentoError::InvalidOperator
  )]
  pub operator: Signer<'info>,

  #[account(
    init,
    payer = operator,
    space = Config::space(),
    seeds = [PREFIX_SEED, b"config"],
    bump
  )]
  pub config: Account<'info, Config>,

  pub system_program: Program<'info, System>,
}
