use anchor_lang::error_code;

#[error_code]
pub enum BentoError {
  #[msg("Invalid Operator")]
  InvalidOperator,
}
