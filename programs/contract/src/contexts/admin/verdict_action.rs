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

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct VerdictActionParams {
  pub raw_score: u32,
  pub reasoning_hash: [u8; 32],
}

pub fn process(ctx: Context<VerdictAction>, params: VerdictActionParams) -> Result<()> {
  let VerdictActionParams {
    raw_score,
    reasoning_hash,
  } = params;

  let config = &ctx.accounts.config;
  config.is_in_maintenance()?;

  let decision = config.decision_for(raw_score);
  let agent_key = ctx.accounts.agent.key();

  let target_program;
  let value;
  {
    let action = &mut ctx.accounts.action.load_mut()?;
    action.must_be_in_status(ActionStatus::Pending)?;
    action.must_belong_to_agent(agent_key)?;

    action.raw_score = raw_score;
    action.decision = decision.into();
    action.reasoning_hash = reasoning_hash;
    action.move_to_status(decision);

    target_program = action.target_program;
    value = action.value;
  }

  let (threat_score, strikes, strike_added, auto_deactivated) = {
    let agent = &mut ctx.accounts.agent;

    agent.apply_threat_score(raw_score, config.ema_alpha, config.ema_scale);
    agent.record_decision(decision);

    let strike_added = if raw_score >= config.block_threshold {
      agent.add_strike();
      true
    } else {
      false
    };

    let auto_deactivated = agent.auto_deactivate_if_max_strikes(config.max_strikes);

    (
      agent.threat_score,
      agent.strikes,
      strike_added,
      auto_deactivated,
    )
  };

  let action_pda = ctx.accounts.action.key();
  match decision {
    ActionStatus::Approved => emit!(event::ActionApproved {
      action: action_pda,
      agent: agent_key,
      target_program,
      value,
      raw_score,
      threat_score,
    }),
    ActionStatus::Escalated => emit!(event::ActionEscalated {
      action: action_pda,
      agent: agent_key,
      target_program,
      value,
      raw_score,
      threat_score,
      reasoning_hash,
    }),
    ActionStatus::Blocked => emit!(event::ActionBlocked {
      action: action_pda,
      agent: agent_key,
      target_program,
      value,
      raw_score,
      threat_score,
      reasoning_hash,
    }),
    _ => {}
  }

  if strike_added {
    emit!(event::StrikeAdded {
      agent: agent_key,
      strikes,
      raw_score,
    });
  }

  if auto_deactivated {
    emit!(event::AgentAutoDeactivated {
      agent: agent_key,
      threat_score,
      strikes,
    });
  }

  // The Agent PDA is the delegated bundle payer (kept topped up on the ER);
  let agent_wallet = ctx.accounts.agent.agent_wallet;
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
pub struct VerdictAction<'info> {
  #[account(
    mut,
    constraint = relayer.key() == config.relayer @ BentoError::InvalidRelayer
  )]
  pub relayer: Signer<'info>,

  #[account(mut)]
  pub agent: Account<'info, Agent>,

  #[account(mut)]
  pub action: AccountLoader<'info, Action>,

  #[account(
    seeds = [constant::PREFIX_SEED, b"config"],
    bump = config.bump
  )]
  pub config: Account<'info, Config>,

  /// CHECK: Magic fee vault PDA. Lifts the 10-commit sponsorship cap. Validated by the ER SDK.
  #[account(mut)]
  pub magic_fee_vault: AccountInfo<'info>,
}
