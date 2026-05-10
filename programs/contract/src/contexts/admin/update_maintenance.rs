use anchor_lang::prelude::*;

use crate::states::Config;

pub fn process(ctx: Context<UpdateMaintenance>, maintenance: bool) -> Result<()> {
  let config = &mut ctx.accounts.config;
  config.maintenance = maintenance;

  Ok(())
}

#[derive(Accounts)]
pub struct UpdateMaintenance<'info> {
  #[account(
    mut,
    constraint = config.operator == operator.key()
  )]
  pub operator: Signer<'info>,

  #[account(mut)]
  pub config: Account<'info, Config>,
}
