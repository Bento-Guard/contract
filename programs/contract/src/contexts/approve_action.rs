use anchor_lang::prelude::*;

use crate::{
  common::event,
  states::{Action, ActionStatus, Agent},
};

pub fn process(ctx: Context<ApproveAction>) -> Result<()> {
  let agent = &mut ctx.accounts.agent;
  let action = &mut ctx.accounts.action.load_mut()?;
  action.must_belong_to_agent(agent.key())?;
  action.must_be_in_status(ActionStatus::ESCALATED)?;

  action.move_to_status(ActionStatus::APPROVED);

  emit!(event::EscalationResolved {
    action_id: action.action_id,
    agent: agent.key(),
    final_decision: action.decision,
    owner: agent.owner,
  });

  Ok(())
}

#[derive(Accounts)]
pub struct ApproveAction<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(has_one = owner)]
  pub agent: Account<'info, Agent>,

  #[account(mut)]
  pub action: AccountLoader<'info, Action>,
}
