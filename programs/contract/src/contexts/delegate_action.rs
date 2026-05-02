use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::{
  common::{constant, error::BentoError},
  states::{Agent, Config},
};

pub fn process(ctx: Context<DelegateAction>) -> Result<()> {
  {
    let config = &ctx.accounts.config;
    config.is_in_maintenance()?;
  }

  {
    let agent_data = ctx.accounts.agent.try_borrow_data()?;
    let agent = Agent::try_deserialize(&mut &agent_data[..])?;
    if agent.owner != ctx.accounts.owner.key() {
      return err!(BentoError::InvalidAgentOwner);
    }
  }

  // Read just the two fields we need (`agent: Pubkey`, `action_id: u64`) by
  // raw byte offset — the Action layout is `#[account(zero_copy)] +
  // #[repr(C, packed)]`, so:
  //   bytes 0..8   : Anchor discriminator
  //   bytes 8..40  : agent (Pubkey, 32 bytes)
  //   bytes 40..48 : action_id (u64 LE, 8 bytes)
  let (action_agent, action_id_le) = {
    let action_data = ctx.accounts.action.try_borrow_data()?;
    let agent_bytes: [u8; 32] = action_data[8..40]
      .try_into()
      .map_err(|_| error!(BentoError::DelegationWrongActionNotBelongToAgent))?;
    let action_agent = Pubkey::from(agent_bytes);
    if action_agent != ctx.accounts.agent.key() {
      return err!(BentoError::DelegationWrongActionNotBelongToAgent);
    }
    let action_id_le: [u8; 8] = action_data[40..48]
      .try_into()
      .map_err(|_| error!(BentoError::DelegationWrongActionNotBelongToAgent))?;
    (action_agent, action_id_le)
  };

  ctx.accounts.delegate_action(
    &ctx.accounts.owner,
    &[
      constant::PREFIX_SEED,
      b"action",
      action_agent.as_ref(),
      action_id_le.as_ref(),
    ],
    DelegateConfig {
      validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
      ..Default::default()
    },
  )?;

  Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateAction<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  /// CHECK:
  pub agent: AccountInfo<'info>,

  #[account(mut, del)]
  /// CHECK:
  pub action: AccountInfo<'info>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,
}
