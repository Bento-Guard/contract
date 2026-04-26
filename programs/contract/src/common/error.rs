use anchor_lang::error_code;

#[error_code]
pub enum BentoError {
  #[msg("Bento is in maintenance")]
  BentoIsInMaintenance,

  #[msg("Invalid Operator")]
  InvalidOperator,

  #[msg("Allowed target program already exists")]
  AllowedTargetProgramAlreadyExists,

  #[msg("Allowed target program reached limit")]
  AllowedTargetProgramReachedLimit,

  #[msg("Delegation wrong action not belong to agent")]
  DelegationWrongActionNotBelongToAgent,

  #[msg("Data length too large")]
  PayloadTooLarge,

  #[msg("Action is not in initial state")]
  ActionIsNotInInitialState,

  #[msg("Invalid offset payload data")]
  InvalidOffsetPayloadData,

  #[msg("Action does not belong to agent")]
  ActionDoesNotBelongToAgent,

  #[msg("Agent already active")]
  AgentAlreadyActive,
}
