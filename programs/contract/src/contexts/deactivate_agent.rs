use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_and_undelegate_accounts};

use crate::{common::event, states::Agent};

pub fn process(ctx: Context<DeactivateAgent>) -> Result<()> {
  let agent = &mut ctx.accounts.agent;
  agent.deactivate();

  commit_and_undelegate_accounts(
    &ctx.accounts.owner,
    vec![&ctx.accounts.agent.to_account_info()],
    &ctx.accounts.magic_context,
    &ctx.accounts.magic_program,
  )?;

  emit!(event::DeactivateAgent {
    agent: ctx.accounts.agent.key(),
  });

  Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct DeactivateAgent<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(
    mut,
    has_one = owner,
  )]
  pub agent: Account<'info, Agent>,
}
