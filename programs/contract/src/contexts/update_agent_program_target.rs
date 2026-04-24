use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;

use crate::{
  common::constant,
  states::{Agent, AllowedTarget},
};

pub fn process(ctx: Context<UpdateAgentProgramTarget>, target_update: AllowedTarget) -> Result<()> {
  let agent = &mut ctx.accounts.agent;

  let existing = agent.find_mut_program_allowed_target(target_update.target);
  if let Some(target) = existing {
    target.allowed = target_update.allowed;
  } else {
    agent.add_program_allowed_target(target_update.target)?;
  }

  Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct UpdateAgentProgramTarget<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(mut)]
  pub agent_wallet: Signer<'info>,

  #[account(
    mut,
    seeds = [constant::PREFIX_SEED, b"agent", agent_wallet.key().as_ref()],
    bump = agent.bump
  )]
  pub agent: Account<'info, Agent>,
}
