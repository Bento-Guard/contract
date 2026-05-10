use anchor_lang::prelude::*;

use crate::{
  common::{constant, error::BentoError},
  states::{Action, ActionStatus, Agent, Config},
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AppendPayloadParams {
  offset: u32,
  chunk: Vec<u8>,
}

pub fn process(ctx: Context<AppendPayload>, params: AppendPayloadParams) -> Result<()> {
  let AppendPayloadParams { offset, chunk } = params;

  let (data_len, data_written) = {
    let action = ctx.accounts.action.load()?;
    action.must_be_in_status(ActionStatus::Initialization)?;
    (action.data_len, action.data_written)
  };

  require!(offset == data_written, BentoError::InvalidOffsetPayloadData);
  let end = offset as usize + chunk.len();
  require!(end <= data_len as usize, BentoError::PayloadTooLarge);

  let mut action = ctx.accounts.action.load_mut()?;
  action.encrypted_payload[offset as usize..end].copy_from_slice(&chunk);
  action.data_written = end as u32;

  Ok(())
}

#[derive(Accounts)]
pub struct AppendPayload<'info> {
  #[account(
    mut,
    constraint = relayer.key() == config.relayer @ BentoError::InvalidRelayer
  )]
  pub relayer: Signer<'info>,

  pub owner: Signer<'info>,

  #[account(has_one = owner)]
  pub agent: Account<'info, Agent>,

  #[account(mut)]
  pub action: AccountLoader<'info, Action>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
