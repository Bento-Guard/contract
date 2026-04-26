use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::{
  common::{constant, error::BentoError, event},
  states::{Agent, AgentStatus},
};

pub fn process(ctx: Context<ActiveAgent>) -> Result<()> {
  {
    let agent = &mut ctx.accounts.agent;

    if agent.active != AgentStatus::Inactive.into() {
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
}
