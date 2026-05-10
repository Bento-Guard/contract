export const PREFIX_SEED = "bento";

export const DISCRIMINATOR_SIZE = 8;

export const MAX_PAYLOAD = 8192;

export const MAX_ALLOWED_TARGETS = 10;

export const actionStatus = {
  initialization: 0,
  pending: 1,
  approved: 2,
  escalated: 3,
  blocked: 4,
  rejected: 5,
} as const;

export type ActionStatus = (typeof actionStatus)[keyof typeof actionStatus];

export const agentStatus = {
  inactive: 0,
  active: 1,
} as const;

export type AgentStatus = (typeof agentStatus)[keyof typeof agentStatus];
