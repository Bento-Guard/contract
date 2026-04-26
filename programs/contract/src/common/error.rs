use anchor_lang::error_code;

#[error_code]
pub enum BentoError {
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
}
