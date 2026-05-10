use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};

use crate::{
  common::constant,
  states::{Agent, AllowedTarget, Config},
};

pub fn process(ctx: Context<UpdateAgentProgramTarget>, target_update: AllowedTarget) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  let agent = &mut ctx.accounts.agent;

  let existing = agent.find_mut_program_allowed_target(target_update.target);
  if let Some(target) = existing {
    target.allowed = target_update.allowed;
  } else {
    agent.add_program_allowed_target(target_update.target)?;
  }

  commit_accounts(
    &ctx.accounts.owner,
    vec![&ctx.accounts.agent.to_account_info()],
    &ctx.accounts.magic_context,
    &ctx.accounts.magic_program,
  )?;

  Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct UpdateAgentProgramTarget<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  pub agent_wallet: Signer<'info>,

  #[account(
    mut,
    seeds = [constant::PREFIX_SEED, b"agent", agent_wallet.key().as_ref()],
    bump = agent.bump
  )]
  pub agent: Account<'info, Agent>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
