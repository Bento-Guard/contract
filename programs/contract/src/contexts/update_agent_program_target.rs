use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
  anchor::commit,
  ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder},
};

use crate::{
  common::{constant, error::BentoError},
  states::{Agent, AllowedTarget, Config, VaultSponsor},
  utils::magicblock_utils::as_signer,
};

pub fn process(ctx: Context<UpdateAgentProgramTarget>, target_update: AllowedTarget) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  {
    let agent = &mut ctx.accounts.agent;

    let existing = agent.find_mut_program_allowed_target(target_update.target);
    if let Some(target) = existing {
      target.allowed = target_update.allowed;
    } else {
      agent.add_program_allowed_target(target_update.target)?;
    }
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

  Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct UpdateAgentProgramTarget<'info> {
  #[account(
    mut,
    constraint = relayer.key() == config.relayer @ BentoError::InvalidRelayer
  )]
  pub relayer: Signer<'info>,

  pub owner: Signer<'info>,

  pub agent_wallet: Signer<'info>,

  #[account(
    mut,
    seeds = [constant::PREFIX_SEED, b"agent", agent_wallet.key().as_ref()],
    bump = agent.bump
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
