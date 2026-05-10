use anchor_lang::prelude::*;

use crate::{
  common::{constant, error::BentoError, event},
  states::{Action, ActionStatus, Agent, Config},
};

pub fn process(ctx: Context<RejectAction>) -> Result<()> {
  let agent = &mut ctx.accounts.agent;
  let action = &mut ctx.accounts.action.load_mut()?;
  action.must_belong_to_agent(agent.key())?;
  action.must_be_in_status(ActionStatus::Escalated)?;

  action.move_to_status(ActionStatus::Rejected);

  emit!(event::EscalationResolved {
    action_id: action.action_id,
    agent: agent.key(),
    final_decision: action.decision,
    owner: agent.owner,
  });

  Ok(())
}

#[derive(Accounts)]
pub struct RejectAction<'info> {
  #[account(
    mut,
    constraint = relayer.key() == config.relayer @ BentoError::InvalidRelayer
  )]
  pub relayer: Signer<'info>,

  pub owner: Signer<'info>,

  #[account(has_one = owner)]
  pub agent: Account<'info, Agent>,

  #[account(mut)]
  pub action: AccountLoader<'info, Action>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
