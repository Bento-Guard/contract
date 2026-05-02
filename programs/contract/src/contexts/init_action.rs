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

  // The Agent PDA stays delegated to the ER for its whole lifecycle, so on
  // L1 its owner is the delegation program — Anchor's `Account<Agent>` would
  // reject that. Read the agent through `AccountInfo`, deserialize the
  // committed L1 stub manually, and verify the owner field matches the
  // signer. Seeds derivation already guarantees `agent.agent_wallet ==
  // agent_wallet.key()`.
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
  #[account(mut)]
  pub owner: Signer<'info>,

  pub agent_wallet: Signer<'info>,

  /// CHECK: Agent PDA. Owner field verified inside the handler. Read as
  /// `AccountInfo` because the agent is delegated to the ER, so on L1 it is
  /// owned by the delegation program and `Account<Agent>` would reject it.
  #[account(
    seeds = [constant::PREFIX_SEED, b"agent", agent_wallet.key().as_ref()],
    bump,
  )]
  pub agent: AccountInfo<'info>,

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

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,

  pub system_program: Program<'info, System>,
}
