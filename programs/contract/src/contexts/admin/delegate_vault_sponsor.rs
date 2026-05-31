use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::{
  common::{constant, error::BentoError, operator::OPERATOR_PUBKEY},
  states::Config,
};

pub fn process(ctx: Context<DelegateVaultSponsor>) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  ctx.accounts.delegate_vault_sponsor(
    &ctx.accounts.operator,
    &[constant::PREFIX_SEED, b"vault_sponsor"],
    DelegateConfig {
      validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
      ..Default::default()
    },
  )?;

  Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateVaultSponsor<'info> {
  #[account(
    mut,
    constraint = operator.key() == OPERATOR_PUBKEY @ BentoError::InvalidOperator
  )]
  pub operator: Signer<'info>,

  /// CHECK: VaultSponsor PDA being delegated. Address pinned by the seeds passed
  /// to `delegate_vault_sponsor`; operator authority enforced above.
  #[account(mut, del)]
  pub vault_sponsor: AccountInfo<'info>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
