use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::{
  common::{constant, event},
  states::{Agent, Config},
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RegisterAgentParams {
  pub spend_limit: u64,
}

pub fn process(ctx: Context<RegisterAgent>, params: RegisterAgentParams) -> Result<()> {
  let agent_wallet = ctx.accounts.agent_wallet.key();
  let agent = &mut ctx.accounts.agent;
  let config = &mut ctx.accounts.config;

  agent.init(
    ctx.accounts.agent_wallet.key(),
    ctx.accounts.owner.key(),
    params.spend_limit,
    ctx.bumps.agent,
  );
  config.increment_agents();

  ctx.accounts.delegate_agent(
    &ctx.accounts.owner,
    &[constant::PREFIX_SEED, b"agent", agent_wallet.key().as_ref()],
    DelegateConfig {
      validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
      ..Default::default()
    },
  )?;

  emit!(event::RegisterAgent {
    agent_wallet,
    owner: ctx.accounts.owner.key(),
  });

  Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct RegisterAgent<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(mut)]
  pub agent_wallet: Signer<'info>,

  #[account(
    init,
    del,
    payer = owner,
    space = Agent::space(),
    seeds = [constant::PREFIX_SEED, b"agent", agent_wallet.key().as_ref()],
    bump
  )]
  pub agent: Account<'info, Agent>,

  #[account(
    mut,
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,

  pub system_program: Program<'info, System>,
}
