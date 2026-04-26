use anchor_lang::prelude::*;

mod program_id;
use program_id::PROGRAM_ID;
mod common;
use common::*;
mod contexts;
use contexts::*;
mod states;
use states::*;

declare_id!(PROGRAM_ID);

#[program]
pub mod contract {
  use super::*;

  pub fn initialize(ctx: Context<InitializeConfig>, params: InitializeConfigParams) -> Result<()> {
    admin::initialize::process(ctx, params)
  }

  pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
    admin::update_confg::process(ctx, params)
  }

  pub fn register_agent(ctx: Context<RegisterAgent>, params: RegisterAgentParams) -> Result<()> {
    register_agent::process(ctx, params)
  }

  pub fn update_agent_program_target(
    ctx: Context<UpdateAgentProgramTarget>,
    target: AllowedTarget,
  ) -> Result<()> {
    update_agent_program_target::process(ctx, target)
  }

  pub fn init_action(ctx: Context<InitAction>, params: InitActionParams) -> Result<()> {
    init_action::process(ctx, params)
  }

  pub fn delegate_action(ctx: Context<DelegateAction>) -> Result<()> {
    delegate_action::process(ctx)
  }

  pub fn append_payload(ctx: Context<AppendPayload>, params: AppendPayloadParams) -> Result<()> {
    append_payload::process(ctx, params)
  }

  pub fn finalize_action_building(
    ctx: Context<FinalizeActionBuilding>,
    commitment_hash: [u8; 32],
  ) -> Result<()> {
    finalize_action_building::process(ctx, commitment_hash)
  }
}
