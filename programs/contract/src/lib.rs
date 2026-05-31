use anchor_lang::prelude::*;

mod program_id;
use program_id::PROGRAM_ID;
mod common;
use common::*;
mod contexts;
use contexts::*;
mod states;
use states::*;
mod utils;

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

  pub fn update_maintenance(ctx: Context<UpdateMaintenance>, maintenance: bool) -> Result<()> {
    admin::update_maintenance::process(ctx, maintenance)
  }

  pub fn init_vault_sponsor(ctx: Context<InitVaultSponsor>) -> Result<()> {
    admin::init_vault_sponsor::process(ctx)
  }

  pub fn delegate_vault_sponsor(ctx: Context<DelegateVaultSponsor>) -> Result<()> {
    admin::delegate_vault_sponsor::process(ctx)
  }

  pub fn register_agent(ctx: Context<RegisterAgent>, params: RegisterAgentParams) -> Result<()> {
    register_agent::process(ctx, params)
  }

  pub fn delegate_agent(ctx: Context<DelegateAgent>) -> Result<()> {
    delegate_agent::process(ctx)
  }

  pub fn deactivate_agent(ctx: Context<DeactivateAgent>) -> Result<()> {
    deactivate_agent::process(ctx)
  }

  pub fn active_agent(ctx: Context<ActiveAgent>) -> Result<()> {
    active_agent::process(ctx)
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

  pub fn verdict_action(ctx: Context<VerdictAction>, params: VerdictActionParams) -> Result<()> {
    admin::verdict_action::process(ctx, params)
  }

  pub fn approve_action(ctx: Context<ApproveAction>) -> Result<()> {
    approve_action::process(ctx)
  }

  pub fn reject_action(ctx: Context<RejectAction>) -> Result<()> {
    reject_action::process(ctx)
  }
}
