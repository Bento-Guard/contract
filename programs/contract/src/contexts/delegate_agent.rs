use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::{
  common::{constant, error::BentoError},
  states::{Agent, Config},
};

pub fn process(ctx: Context<DelegateAgent>) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  let (agent_wallet, _agent_bump) = {
    let agent_data = ctx.accounts.agent.try_borrow_data()?;
    let agent = Agent::try_deserialize(&mut &agent_data[..])?;

    if agent.owner != ctx.accounts.owner.key() {
      return err!(BentoError::InvalidAgentOwner);
    }

    (agent.agent_wallet, agent.bump)
  };

  ctx.accounts.delegate_agent(
    &ctx.accounts.relayer,
    &[constant::PREFIX_SEED, b"agent", agent_wallet.as_ref()],
    DelegateConfig {
      validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
      ..Default::default()
    },
  )?;

  Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateAgent<'info> {
  #[account(
    mut,
    constraint = relayer.key() == config.relayer @ BentoError::InvalidRelayer
  )]
  pub relayer: Signer<'info>,

  pub owner: Signer<'info>,

  /// CHECK: Agent PDA being delegated. Owner verified inside the handler.
  #[account(mut, del)]
  pub agent: AccountInfo<'info>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
