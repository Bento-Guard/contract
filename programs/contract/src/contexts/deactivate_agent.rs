use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
  anchor::commit,
  ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder},
};

use crate::{
  common::{constant, error::BentoError, event},
  states::{Agent, Config},
  utils::magicblock_utils::as_signer,
};

pub fn process(ctx: Context<DeactivateAgent>) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  let (agent_wallet, agent_bump) = {
    let agent = &mut ctx.accounts.agent;
    agent.deactivate();
    (agent.agent_wallet, agent.bump)
  };

  // The Agent PDA is the delegated bundle payer (kept topped up on the ER)
  let agent_seeds: &[&[&[u8]]] = &[&[
    constant::PREFIX_SEED,
    b"agent",
    agent_wallet.as_ref(),
    &[agent_bump],
  ]];

  MagicIntentBundleBuilder::new(
    as_signer(ctx.accounts.agent.to_account_info()),
    ctx.accounts.magic_context.to_account_info(),
    ctx.accounts.magic_program.to_account_info(),
  )
  .magic_fee_vault(ctx.accounts.magic_fee_vault.to_account_info())
  .commit(&[ctx.accounts.agent.to_account_info()])
  .build_and_invoke_signed(agent_seeds)?;

  emit!(event::DeactivateAgent {
    agent: ctx.accounts.agent.key(),
  });

  Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct DeactivateAgent<'info> {
  #[account(
    mut,
    constraint = relayer.key() == config.relayer @ BentoError::InvalidRelayer
  )]
  pub relayer: Signer<'info>,

  pub owner: Signer<'info>,

  #[account(
    mut,
    has_one = owner,
  )]
  pub agent: Account<'info, Agent>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,

  /// CHECK: Magic fee vault PDA. Lifts the 10-commit sponsorship cap. Validated by the ER SDK.
  #[account(mut)]
  pub magic_fee_vault: AccountInfo<'info>,
}
