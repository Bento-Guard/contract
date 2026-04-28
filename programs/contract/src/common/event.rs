use anchor_lang::prelude::*;

#[event]
pub struct InitializeConfig {
  pub config: Pubkey,
}

#[event]
pub struct UpdateConfig {
  pub config: Pubkey,
}

#[event]
pub struct RegisterAgent {
  pub agent_wallet: Pubkey,
  pub owner: Pubkey,
}

#[event]
pub struct DeactivateAgent {
  pub agent: Pubkey,
}

#[event]
pub struct ActiveAgent {
  pub agent: Pubkey,
}

#[event]
pub struct InitAction {
  pub action_id: u64,
  pub target_program: Pubkey,
  pub value: u64,
  pub agent: Pubkey,
}

#[event]
pub struct ActionSubmitted {
  pub action_id: u64,
  pub agent: Pubkey,
}

#[event]
pub struct ActionApproved {
  pub action: Pubkey,
  pub agent: Pubkey,
  pub target_program: Pubkey,
  pub value: u64,
  pub raw_score: u32,
  pub threat_score: u32,
}

#[event]
pub struct ActionEscalated {
  pub action: Pubkey,
  pub agent: Pubkey,
  pub target_program: Pubkey,
  pub value: u64,
  pub raw_score: u32,
  pub threat_score: u32,
  pub reasoning_hash: [u8; 32],
}

#[event]
pub struct ActionBlocked {
  pub action: Pubkey,
  pub agent: Pubkey,
  pub target_program: Pubkey,
  pub value: u64,
  pub raw_score: u32,
  pub threat_score: u32,
  pub reasoning_hash: [u8; 32],
}

#[event]
pub struct StrikeAdded {
  pub agent: Pubkey,
  pub strikes: u8,
  pub raw_score: u32,
}

#[event]
pub struct AgentAutoDeactivated {
  pub agent: Pubkey,
  pub threat_score: u32,
  pub strikes: u8,
}

#[event]
pub struct EscalationResolved {
  pub action_id: u64,
  pub agent: Pubkey,
  pub owner: Pubkey,
  pub final_decision: u8,
}
