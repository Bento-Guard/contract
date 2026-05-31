use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
  anchor::commit,
  ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder},
};

use crate::{
  common::{constant, error::BentoError, event},
  states::{Agent, AgentStatus, Config, VaultSponsor},
  utils::magicblock_utils::as_signer,
};

pub fn process(ctx: Context<ActiveAgent>) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  {
    let agent = &mut ctx.accounts.agent;
    if agent.active != bool::from(AgentStatus::Inactive) {
      return err!(BentoError::AgentAlreadyActive);
    }
    agent.activate();
  }

  let vault_sponsor_bump = ctx.accounts.vault_sponsor.bump;
  let vault_sponsor_seeds: &[&[&[u8]]] = &[&[
    constant::PREFIX_SEED,
    b"vault_sponsor",
    &[vault_sponsor_bump],
  ]];

  MagicIntentBundleBuilder::new(
    as_signer(ctx.accounts.vault_sponsor.to_account_info()),
    ctx.accounts.magic_context.to_account_info(),
    ctx.accounts.magic_program.to_account_info(),
  )
  .magic_fee_vault(ctx.accounts.magic_fee_vault.to_account_info())
  .commit(&[ctx.accounts.agent.to_account_info()])
  .build_and_invoke_signed(vault_sponsor_seeds)?;

  emit!(event::ActiveAgent {
    agent: ctx.accounts.agent.key(),
  });

  Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct ActiveAgent<'info> {
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
    mut,
    seeds = [constant::PREFIX_SEED, b"vault_sponsor"],
    bump = vault_sponsor.bump
  )]
  pub vault_sponsor: Account<'info, VaultSponsor>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,

  /// CHECK: Magic fee vault PDA. Lifts the 10-commit sponsorship cap. Validated by the ER SDK.
  #[account(mut)]
  pub magic_fee_vault: AccountInfo<'info>,
}
