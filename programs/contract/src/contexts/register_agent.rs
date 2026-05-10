use anchor_lang::prelude::*;

use crate::{
  common::{constant, event},
  states::{Agent, Config},
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RegisterAgentParams {
  pub spend_limit: u64,
}

pub fn process(ctx: Context<RegisterAgent>, params: RegisterAgentParams) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  let agent_wallet = ctx.accounts.agent_wallet.key();
  let agent = &mut ctx.accounts.agent;
  let config = &mut ctx.accounts.config;

  agent.init(
    agent_wallet,
    ctx.accounts.owner.key(),
    params.spend_limit,
    ctx.bumps.agent,
  );
  config.increment_agents();

  emit!(event::RegisterAgent {
    agent_wallet,
    owner: ctx.accounts.owner.key(),
  });

  Ok(())
}

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(mut)]
  pub agent_wallet: Signer<'info>,

  #[account(
    init,
    payer = owner,
    space = Agent::space(),
    seeds = [constant::PREFIX_SEED, b"agent", agent_wallet.key().as_ref()],
    bump
  )]
  pub agent: Box<Account<'info, Agent>>,

  #[account(
    mut,
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Box<Account<'info, Config>>,

  pub system_program: Program<'info, System>,
}
