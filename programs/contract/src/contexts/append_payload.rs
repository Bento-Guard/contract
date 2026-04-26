use anchor_lang::prelude::*;

use crate::{
  common::error::BentoError,
  states::{Action, ActionStatus, Agent},
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AppendPayloadParams {
  offset: u32,
  chunk: Vec<u8>,
}

pub fn process(ctx: Context<AppendPayload>, params: AppendPayloadParams) -> Result<()> {
  let AppendPayloadParams { offset, chunk } = params;

  let action = &mut ctx.accounts.action.load()?;
  action.must_be_in_status(ActionStatus::INITIALIZATION)?;

  // Validate chunks fit
  require!(
    offset == action.data_written,
    BentoError::InvalidOffsetPayloadData
  );
  let end = offset as usize + chunk.len();
  require!(end <= action.data_len as usize, BentoError::PayloadTooLarge);

  {
    let mut action = ctx.accounts.action.load_init()?;
    action.encrypted_payload[offset as usize..end].copy_from_slice(&chunk);
    action.data_written = end as u32;
  }

  Ok(())
}

#[derive(Accounts)]
pub struct AppendPayload<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(mut, has_one = owner,)]
  pub agent: Account<'info, Agent>,

  #[account(mut)]
  pub action: AccountLoader<'info, Action>,
}
