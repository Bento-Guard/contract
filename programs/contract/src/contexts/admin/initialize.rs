use anchor_lang::prelude::*;

use crate::{common::event, Config};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
  #[account(mut)]
  pub signer: Signer<'info>,
  pub config: Account<'info, Config>,
  pub system_program: Program<'info, System>,
}
