use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
  anchor::commit,
  ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder},
};

use crate::{
  common::{constant, error::BentoError, event},
  states::{Action, ActionStatus, Agent, Config},
  utils::magicblock_utils::as_signer,
};

pub fn process(ctx: Context<FinalizeActionBuilding>, commitment_hash: [u8; 32]) -> Result<()> {
  let (action_id, agent_key) = {
    let mut action = ctx.accounts.action.load_mut()?;
    action.must_belong_to_agent(ctx.accounts.agent.key())?;
    action.must_be_in_status(ActionStatus::Initialization)?;

    action.move_to_status(ActionStatus::Pending);
    action.commitment = commitment_hash;

    (action.action_id, action.agent)
  };

  emit!(event::ActionSubmitted {
    action_id,
    agent: agent_key,
  });

  // The Agent PDA is the delegated bundle payer (kept topped up on the ER); it
  // signs the commit via its seeds.
  let agent_wallet = ctx.accounts.agent_wallet.key();
  let agent_bump = ctx.accounts.agent.bump;
  let agent_seeds: &[&[&[u8]]] = &[&[
    constant::PREFIX_SEED,
    b"agent",
    agent_wallet.as_ref(),
    &[agent_bump],
  ]];

  MagicIntentBundleBuilder::new(
    as_signer(ctx.accounts.agent.to_account_info()),
    ctx.accounts.magic_context.to_account_info(),
    ctx.accounts.magic_program.to_account_info(),
  )
  .magic_fee_vault(ctx.accounts.magic_fee_vault.to_account_info())
  .commit(&[
    ctx.accounts.action.to_account_info(),
    ctx.accounts.agent.to_account_info(),
  ])
  .build_and_invoke_signed(agent_seeds)?;

  Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct FinalizeActionBuilding<'info> {
  #[account(
    mut,
    constraint = relayer.key() == config.relayer @ BentoError::InvalidRelayer
  )]
  pub relayer: Signer<'info>,

  pub agent_wallet: Signer<'info>,

  #[account(mut, has_one = agent_wallet)]
  pub agent: Account<'info, Agent>,

  #[account(mut)]
  pub action: AccountLoader<'info, Action>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,

  /// CHECK: Magic fee vault PDA derived from `[b"magic-fee-vault", validator]`
  /// under the ephemeral-rollups SDK program. Lifts the 10-commit sponsorship cap.
  /// The ER program validates this PDA against the delegation record.
  #[account(mut)]
  pub magic_fee_vault: AccountInfo<'info>,
}
