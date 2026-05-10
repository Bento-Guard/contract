use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};

use crate::{
  common::{constant, error::BentoError, event},
  states::{Agent, Config},
};

pub fn process(ctx: Context<DeactivateAgent>) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  let agent = &mut ctx.accounts.agent;
  agent.deactivate();

  commit_accounts(
    &ctx.accounts.relayer,
    vec![&ctx.accounts.agent.to_account_info()],
    &ctx.accounts.magic_context,
    &ctx.accounts.magic_program,
  )?;

  emit!(event::DeactivateAgent {
    agent: ctx.accounts.agent.key(),
  });

  Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct DeactivateAgent<'info> {
  #[account(
    mut,
    constraint = relayer.key() == config.relayer @ BentoError::InvalidRelayer
  )]
  pub relayer: Signer<'info>,

  pub owner: Signer<'info>,

  #[account(
    mut,
    has_one = owner,
  )]
  pub agent: Account<'info, Agent>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
