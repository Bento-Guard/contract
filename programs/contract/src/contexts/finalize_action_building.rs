use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};

use crate::{
  common::event,
  states::{Action, ActionStatus, Agent},
};

pub fn process(ctx: Context<FinalizeActionBuilding>, commitment_hash: [u8; 32]) -> Result<()> {
  let action = &mut ctx.accounts.action.load_mut()?;
  action.must_belong_to_agent(ctx.accounts.agent.key())?;
  action.must_be_in_status(ActionStatus::INITIALIZATION)?;

  action.move_to_status(ActionStatus::PENDING);
  action.commitment = commitment_hash;

  emit!(event::ActionSubmitted {
    action_id: action.action_id,
    agent: action.agent,
  });

  commit_accounts(
    &ctx.accounts.owner,
    vec![
      &ctx.accounts.action.to_account_info(),
      &ctx.accounts.agent.to_account_info(), // sync latest total action agent from ER to main chain
    ],
    &ctx.accounts.magic_context,
    &ctx.accounts.magic_program,
  )?;

  Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct FinalizeActionBuilding<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(has_one = owner,)]
  pub agent: Account<'info, Agent>,

  #[account(mut)]
  pub action: AccountLoader<'info, Action>,
}
