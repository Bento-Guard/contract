use anchor_lang::prelude::*;

use crate::{
  common::{constant, event},
  states::{Action, Agent},
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitActionParams {
  pub target_program: Pubkey,
  pub value: u64,
  pub action_id: u64,
}

pub fn process(ctx: Context<InitAction>, params: InitActionParams) -> Result<()> {
  let action = &mut ctx.accounts.action.load_init()?;

  action.init(
    ctx.accounts.agent.key(),
    params.action_id,
    params.target_program,
    params.value,
    ctx.bumps.action,
  );

  emit!(event::InitAction {
    action_id: params.action_id,
    target_program: params.target_program,
    value: params.value,
    agent: ctx.accounts.agent.key(),
  });

  Ok(())
}

#[derive(Accounts)]
#[instruction(params: InitActionParams)]
pub struct InitAction<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  pub agent_wallet: Signer<'info>,

  #[account(
    has_one = owner,
    has_one = agent_wallet,
 )]
  pub agent: Account<'info, Agent>, // Still in ER

  #[account(
    init,
    payer = owner,
    space = Action::space(),
    seeds = [
      constant::PREFIX_SEED,
      b"action",
      agent.key().as_ref(),
      params.action_id.to_le_bytes().as_ref(),
    ],
    bump,
  )]
  pub action: AccountLoader<'info, Action>,

  pub system_program: Program<'info, System>,
}
