use anchor_lang::prelude::*;

use crate::{
  common::{constant, error::BentoError, event},
  states::{Action, Agent, Config, MAX_PAYLOAD},
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitActionParams {
  pub target_program: Pubkey,
  pub value: u64,
  pub action_id: u64,
  pub total_data_len: u32,
}

pub fn process(ctx: Context<InitAction>, params: InitActionParams) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  require!(
    params.total_data_len <= MAX_PAYLOAD as u32,
    BentoError::PayloadTooLarge
  );

  // Verify agent structure and owner
  {
    let agent_data = ctx.accounts.agent.try_borrow_data()?;
    let agent = Agent::try_deserialize(&mut &agent_data[..])?;
    if agent.owner != ctx.accounts.owner.key() {
      return err!(BentoError::InvalidAgentOwner);
    }
  }

  let action = &mut ctx.accounts.action.load_init()?;

  action.init(
    ctx.accounts.agent.key(),
    params.action_id,
    params.target_program,
    params.value,
    params.total_data_len,
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
  #[account(
    mut,
    constraint = relayer.key() == config.relayer @ BentoError::InvalidRelayer
  )]
  pub relayer: Signer<'info>,

  pub owner: Signer<'info>,

  pub agent_wallet: Signer<'info>,

  /// CHECK: Agent PDA. Owner field verified inside the handler.
  #[account(
    seeds = [constant::PREFIX_SEED, b"agent", agent_wallet.key().as_ref()],
    bump,
  )]
  pub agent: AccountInfo<'info>,

  #[account(
    init,
    payer = relayer,
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

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,

  pub system_program: Program<'info, System>,
}
