use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::{
  common::{constant, error::BentoError, event},
  states::{Agent, AgentStatus, Config},
};

pub fn process(ctx: Context<ActiveAgent>) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;

    let agent = &mut ctx.accounts.agent;

    if agent.active != bool::from(AgentStatus::Inactive) {
      return err!(BentoError::AgentAlreadyActive);
    }

    agent.activate();
  }

  let agent = &ctx.accounts.agent;
  ctx.accounts.delegate_agent(
    &ctx.accounts.owner,
    &[
      constant::PREFIX_SEED,
      b"agent",
      agent.agent_wallet.key().as_ref(),
    ],
    DelegateConfig {
      validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
      ..Default::default()
    },
  )?;

  emit!(event::ActiveAgent { agent: agent.key() });

  Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct ActiveAgent<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(
    mut,
    del,
    has_one = owner,
  )]
  pub agent: Account<'info, Agent>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
