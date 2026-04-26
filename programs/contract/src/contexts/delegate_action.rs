use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::{
  common::{constant, error::BentoError},
  states::{Action, Agent, Config},
};

pub fn process(ctx: Context<DelegateAction>) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  let action = &ctx.accounts.action.load()?;

  if action.agent != ctx.accounts.agent.key() {
    return err!(BentoError::DelegationWrongActionNotBelongToAgent);
  }

  ctx.accounts.delegate_action(
    &ctx.accounts.owner,
    &[
      constant::PREFIX_SEED,
      b"action",
      action.agent.as_ref(),
      action.action_id.to_le_bytes().as_ref(),
    ],
    DelegateConfig {
      validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
      ..Default::default()
    },
  )?;

  Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateAction<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(has_one = owner)]
  pub agent: Account<'info, Agent>,

  #[account(mut, del)]
  pub action: AccountLoader<'info, Action>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
