use anchor_lang::prelude::*;

use crate::{
  common::{error::BentoError, event, operator::OPERATOR_PUBKEY, PREFIX_SEED},
  states::VaultSponsor,
};

pub fn process(ctx: Context<InitVaultSponsor>) -> Result<()> {
  let operator = ctx.accounts.operator.key();
  let vault_sponsor = &mut ctx.accounts.vault_sponsor;

  vault_sponsor.init(operator, ctx.bumps.vault_sponsor);

  emit!(event::InitVaultSponsor {
    vault_sponsor: vault_sponsor.key(),
    operator,
  });

  Ok(())
}

#[derive(Accounts)]
pub struct InitVaultSponsor<'info> {
  #[account(
    mut,
    constraint = operator.key() == OPERATOR_PUBKEY @ BentoError::InvalidOperator
  )]
  pub operator: Signer<'info>,

  #[account(
    init,
    payer = operator,
    space = VaultSponsor::space(),
    seeds = [PREFIX_SEED, b"vault_sponsor"],
    bump
  )]
  pub vault_sponsor: Account<'info, VaultSponsor>,

  pub system_program: Program<'info, System>,
}
