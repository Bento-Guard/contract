use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};

use crate::{
  common::event,
  states::{Action, ActionStatus, Agent},
};

pub fn process(ctx: Context<FinalizeActionBuilding>, commitment_hash: [u8; 32]) -> Result<()> {
  let (action_id, agent_key) = {
    let mut action = ctx.accounts.action.load_mut()?;
    action.must_belong_to_agent(ctx.accounts.agent.key())?;
    action.must_be_in_status(ActionStatus::Initialization)?;

    action.move_to_status(ActionStatus::Pending);
    action.commitment = commitment_hash;

    (action.action_id, action.agent)
  };

  emit!(event::ActionSubmitted {
    action_id,
    agent: agent_key,
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

  #[account(mut, has_one = owner)]
  pub agent: Account<'info, Agent>,

  #[account(mut)]
  pub action: AccountLoader<'info, Action>,
}
