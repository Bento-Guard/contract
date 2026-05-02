# Bento — Encrypted Security Layer for the Agentic Economy on Solana

## What Is Bento

Bento is an **on-chain firewall for AI agents** on Solana. It intercepts every transaction an agent wants to broadcast, encrypts the intent, analyzes it with an independent LLM (Claude), and only allows execution if the action is deemed safe. If the analysis is uncertain, the action is escalated to the human owner for manual approval.

Bento is inspired by [ENShell](https://enshell.xyz) (built for EVM/Ethereum), adapted for Solana's account model with MagicBlock Ephemeral Rollups for high-throughput processing.

## The Problem

AI agents on Solana hold private keys and sign real transactions — swaps, deposits, transfers. They are vulnerable to:

- **Prompt injection**: malicious data in the agent's context tricks the LLM into executing harmful transactions
- **Agent-to-agent social engineering**: a malicious agent persuades another agent into a bad deal
- **Hallucinated addresses**: the LLM fabricates a wrong address, funds go to the void
- **Intent mismatch**: the LLM says "swap on Orca" but builds a TX that sends to an unknown wallet
- **Goal misalignment**: "maximize yield" leads agent to a honeypot

In Web3, these errors move **irreversible money**. No chargebacks, no undo.

## The Solution

Bento inserts itself between the agent's decision and the broadcast:

```
Without Bento:
  LLM decides → build TX → broadcast immediately (no checks)

With Bento:
  LLM decides → build TX → bento.protect() → wait for verdict → broadcast only if approved
```

The key insight: **the executing agent's LLM cannot validate itself** — if it was prompt-injected, its judgment is already compromised. A **second, independent LLM** (Claude, running in the relayer) cross-references the agent's stated intent against the actual transaction.

## Core Principle: Gatekeeper, Not Executor

**Bento NEVER holds private keys, signs transactions, or moves funds.** Bento is a gatekeeper — it analyzes and says YES / NO / ASK HUMAN. The agent builds, signs, and broadcasts its own transactions. Bento only knows the agent's wallet ADDRESS (public key), never the secret key.

```
Alice (human)           → owns the agent, approves escalations
Alice's Agent (code)    → has the private key, builds TXs, calls bento.protect()
Bento (firewall)        → analyzes intent, writes verdict, tracks reputation
```

---

## Architecture Overview

### Two Layers

```
Layer 1: Smart Contract (Solana program — bento_firewall)
  → Config (operator, relayer, thresholds, maintenance flag)
  → Agent registry with inline allowed-target whitelist + reputation state
  → Action queue (encrypted payload + verdict fields)
  → Runs on L1 + MagicBlock Ephemeral Rollup

Layer 2: Relayer (off-chain service)
  → Watches for ActionSubmitted events
  → Decrypts encrypted payloads from Action PDAs
  → Parses Solana transaction instructions
  → Calls Claude API for threat analysis
  → Submits raw_score + reasoning_hash back to the smart contract via verdict_action
```

### MagicBlock Ephemeral Rollup (ER)

We use MagicBlock ER (non-TEE) for the **action processing hot path**. ER provides:

- 50ms block times (vs ~400ms on L1)
- Dedicated lane — no competition with DeFi traffic
- Fast chunked payload writes

**What lives where:**

| Account     | Location                            | Reason |
|-------------|-------------------------------------|--------|
| Config PDA  | L1 only                             | Rarely changes, globally readable |
| Agent PDA   | L1 → delegated to ER on register, then stays delegated for its whole lifecycle | Hot path during active use; state committed back to L1 on every verdict, finalize, deactivate, and re-activate (Agent stays delegated to ER throughout — `deactivate_agent` and `active_agent` only mirror the new `active` flag to L1) |
| Action PDA  | Created on L1 → delegated to ER     | Chunked writes and verdict happen in ER; committed back to L1 at finalize and at verdict |

The inline `allowed_targets` whitelist is part of the Agent PDA (not a separate account), so it follows the agent through delegation.

### Encryption Model

Agent SDK encrypts the payload (user prompt + serialized instructions) to the relayer's **x25519 public key** (stored in Config PDA on-chain). Uses **ECDH key exchange + ChaCha20-Poly1305** symmetric encryption. The encrypted blob is stored directly in the Action PDA — no separate relay server needed.

The relayer is the only entity that can decrypt (it holds the x25519 private key). The on-chain Config PDA stores only the public key, enabling atomic key rotation via `update_config`.

### Commitment Hash

The SDK computes `blake3(plaintext)` **before** encryption and passes the result as `commitment_hash` to `finalize_action_building`. The program stores it in the Action PDA's `commitment` field. The relayer recomputes the hash after decryption and verifies it matches — detecting tampering between submission and analysis.

(Note: the commitment is supplied at finalize time, not at `init_action`, because chunks are written between init and finalize.)

---

## PDA Structures

### Config PDA (singleton)

```
Seeds: [b"bento", b"config"]
```

Stores global program configuration:

| Field | Type | Notes |
|-------|------|-------|
| `operator` | `Pubkey` | Admin authority — sole signer for config / maintenance updates |
| `relayer` | `Pubkey` | Authorized relayer that may write verdicts |
| `relayer_encryption_key` | `[u8; 32]` | Relayer's x25519 public key |
| `escalate_threshold` | `u32` | Score ≥ this → at least Escalated (suggested default: 40,000) |
| `block_threshold` | `u32` | Score ≥ this → Blocked (suggested default: 70,000) |
| `max_strikes` | `u8` | Strikes before auto-deactivation (suggested default: 5) |
| `ema_alpha` / `ema_scale` | `u16` / `u16` | EMA reputation parameters (suggested defaults: 300 / 1000) |
| `total_agents` | `u64` | Running count of registered agents |
| `bump` | `u8` | |
| `maintenance` | `bool` | When `true`, every mutating handler errors with `BentoIsInMaintenance` |
| `_padding` | `[u64; 8]` | Reserved |

Created once via `initialize()`. Threshold / EMA / strike values are chosen by the operator at init — they are not hardcoded constants. Updated via `update_config()` (any subset of fields, optional) or `update_maintenance()`.

### Agent PDA (one per registered agent)

```
Seeds: [b"bento", b"agent", agent_wallet.key().as_ref()]
```

Stores agent identity, policy, reputation, **and the allowed-target whitelist (inline)**:

| Field | Type | Notes |
|-------|------|-------|
| `agent_wallet` | `Pubkey` | The on-chain wallet operated by the agent |
| `owner` | `Pubkey` | Human owner authorized to manage the agent |
| `spend_limit` | `u64` | Per-action spend limit |
| `threat_score` | `u32` | EMA reputation (low = safe, high = dangerous) |
| `strikes` | `u8` | Accumulated strikes (only goes up) |
| `allowed_targets` | `[AllowedTarget; 10]` | Inline whitelist (`MAX_ALLOWED_TARGETS = 10`) |
| `active` | `bool` | Active flag |
| `registered_at` | `i64` | Registration timestamp (reserved on the struct) |
| `action_counter` | `u64` | Monotonic, used for Action PDA derivation |
| `total_actions` | `u64` | Running counter of all submitted actions |
| `total_approved` / `total_blocked` / `total_escalated` | `u64` | Per-decision stats |
| `bump` | `u8` | |
| `_padding` | `[u64; 8]` | Reserved |

`AllowedTarget` is a `{ target: Pubkey, allowed: bool }` pair. Entries are added or toggled via `update_agent_program_target` — there is **no separate AllowedTarget PDA** anymore.

The Agent PDA IS the public reputation record. No ENS/SNS needed — anyone can read it directly.

### Action PDA (one per submitted action)

```
Seeds: [b"bento", b"action", agent.key().as_ref(), action_id.to_le_bytes()]
```

Uses `#[account(zero_copy)]` with `AccountLoader` and `#[repr(C, packed)]` because it contains a large fixed-size encrypted payload array.

Header fields:

| Field | Type | Notes |
|-------|------|-------|
| `agent` | `Pubkey` | Agent PDA this action belongs to |
| `action_id` | `u64` | SDK-supplied id (monotonic per agent) |
| `target_program` | `Pubkey` | Primary target program of the planned TX |
| `value` | `u64` | Transferred / committed value |
| `commitment` | `[u8; 32]` | `blake3(plaintext)` set at finalize |
| `data_len` | `u32` | Total payload length declared at init |
| `data_written` | `u32` | Cursor advanced by `append_payload` |
| `status` | `u8` | `ActionStatus` (see below) |
| `decision` | `u8` | `u8` mirror of the final `ActionStatus` chosen at verdict (no separate Decision enum) |
| `raw_score` | `u32` | Score reported by the relayer |
| `reasoning_hash` | `[u8; 32]` | `blake3` of Claude's reasoning text |
| `bump` | `u8` | |
| `_padding` | `[u8; 7]` | 8-byte alignment |
| `encrypted_payload` | `[u8; 8192]` | `MAX_PAYLOAD = 8KB` |

**Chunking flow** — the 1,232-byte Solana TX limit means large payloads must be split:

1. `init_action` (L1): create Action PDA with metadata only (`agent`, `action_id`, `target_program`, `value`, `data_len`); status = `Initialization`. No payload, no commitment yet.
2. `delegate_action` (L1): explicit step that delegates the Action PDA to the ER.
3. `append_payload` (ER, 1-N times): write chunks at sequential offsets. Enforces `offset == data_written` and `offset + chunk.len() <= data_len`; writes via `copy_from_slice`.
4. `finalize_action_building` (ER): stores the `commitment_hash` argument, sets status to `Pending`, emits `ActionSubmitted`, and commits both the Action PDA and the Agent PDA back to L1.

**Lifecycle states (`ActionStatus`, `repr(u8)`):**

| Variant | Value | Meaning |
|---------|-------|---------|
| `Initialization` | 0 | Action created; payload being chunked in |
| `Pending` | 1 | Finalized; awaiting relayer verdict (or owner action after escalation) |
| `Approved` | 2 | Auto-approved by relayer, or owner-approved after escalation |
| `Escalated` | 3 | Relayer raised to owner; awaiting `approve_action` / `reject_action` |
| `Blocked` | 4 | Auto-blocked by relayer |
| `Rejected` | 5 | Owner rejected an escalated action |

There is **no separate `Decision` enum** — the `decision` field is a `u8` mirror of the same `ActionStatus` value the action was moved to.

(Note: the current program does not include a `close_action` instruction — Action PDA rent is not yet reclaimed.)

---

## Instruction Set

### Setup & Config (L1, operator only)

| Instruction | Purpose |
|-------------|---------|
| `initialize` | Create Config PDA with relayer pubkey, encryption key, thresholds, max strikes, EMA params |
| `update_config` | Optional fields to rotate relayer / encryption key, change thresholds / strikes / EMA |
| `update_maintenance` | Toggle the `maintenance` flag; while true, all mutating instructions reject with `BentoIsInMaintenance` |

### Agent Lifecycle

| Instruction | Caller | Where | Purpose |
|-------------|--------|-------|---------|
| `register_agent` | Owner + agent wallet (co-signers) | L1 → delegate Agent to ER | Create Agent PDA, set `spend_limit`, mark active, delegate to ER |
| `deactivate_agent` | Owner | ER → commit only (no undelegate) | Set `active = false` and commit the Agent state back to L1 via `commit_accounts`. The Agent PDA remains delegated to the ER after this call — only the data is mirrored to L1 |
| `active_agent` | Owner | ER → commit only (no re-delegate) | Set `active = true` and commit the Agent state back to L1 via `commit_accounts`. Errors with `AgentAlreadyActive` if the agent is currently active. The Agent PDA stays delegated to the ER throughout the lifecycle, so this is a pure state flip — no delegation churn |
| `update_agent_program_target` | Owner + agent wallet | ER (commits Agent back to L1) | Add a new entry to `allowed_targets`, or toggle an existing one's `allowed` boolean |

`register_agent` and `active_agent` accept an optional ER validator pubkey as the first remaining account when delegating.

### Action Flow

| Instruction | Caller | Where | Purpose |
|-------------|--------|-------|---------|
| `init_action` | Owner + agent wallet | L1 | Create Action PDA with metadata + total `data_len`; status = `Initialization` |
| `delegate_action` | Owner | L1 | Delegate the Action PDA to the ER (separate from `init_action`) |
| `append_payload` | Owner | ER | Append an encrypted payload chunk; requires `offset == data_written` |
| `finalize_action_building` | Owner | ER | Store `commitment_hash`, status → `Pending`, emit `ActionSubmitted`, commit Action + Agent back to L1 |
| `verdict_action` | Relayer | (acts on Action delegated to ER) | Write `raw_score` + `reasoning_hash`, decide via Config thresholds, update Agent EMA + strikes, commit Action + Agent back |
| `approve_action` | Owner | — | `Escalated` → `Approved` |
| `reject_action` | Owner | — | `Escalated` → `Rejected` |

### Trust Mesh

Not implemented in the current program (the earlier `check_trust` design is not present).

---

## Verdict Logic

### Score → Decision Mapping

The relayer submits `raw_score` (`u32`) and `reasoning_hash` (`[u8; 32]`) via `verdict_action`. The on-chain program maps the score using the Config thresholds:

```
raw_score < escalate_threshold                       → Approved
escalate_threshold ≤ raw_score < block_threshold     → Escalated  (owner must approve / reject)
raw_score ≥ block_threshold                          → Blocked
```

The chosen `ActionStatus` is written to both `decision` (as `u8`) and `status`.

### EMA Reputation

```
new_score = (alpha * raw_score + (scale - alpha) * prev_score) / scale
example:    (300 * raw + 700 * prev) / 1000
```

Low scores = safe. High scores = dangerous. EMA smooths individual spikes — one bad action doesn't destroy reputation, but persistent bad behavior accumulates.

### Strike System

- Each action with `raw_score >= escalate_threshold` adds a strike (inside `verdict_action`).
- At `max_strikes`, the agent is automatically deactivated (`auto_deactivate_if_max_strikes`) and `AgentAutoDeactivated` is emitted.
- Strikes only go up — they represent permanent history.
- Owner-side rejection via `reject_action` does **not** add a strike in the current code.

---

## Events

| Event | Emitted by |
|-------|-----------|
| `InitializeConfig` | `initialize` |
| `UpdateConfig` | `update_config` |
| `RegisterAgent` | `register_agent` |
| `DeactivateAgent` | `deactivate_agent` |
| `ActiveAgent` | `active_agent` |
| `InitAction` | `init_action` |
| `ActionSubmitted` | `finalize_action_building` |
| `ActionApproved` | `verdict_action` (`raw_score < escalate_threshold`) |
| `ActionEscalated` | `verdict_action` (`escalate ≤ raw_score < block`) |
| `ActionBlocked` | `verdict_action` (`raw_score ≥ block`) |
| `StrikeAdded` | `verdict_action` (when a strike is applied) |
| `AgentAutoDeactivated` | `verdict_action` (when `strikes ≥ max_strikes`) |
| `EscalationResolved` | `approve_action` / `reject_action` |

---

## Relayer: What Claude Actually Analyzes

The relayer decrypts the payload and gets: user prompt + serialized Solana instructions. It parses each instruction to extract program IDs, accounts, and data. Then it builds a Claude prompt combining:

**From the decrypted payload:**
- Original user prompt ("swap 0.5 USDC on Orca")
- Each instruction's program ID, accounts, decoded data

**From on-chain state:**
- Agent's threat score, strikes, inline allowed targets
- Spend limit vs action value

**From Bento's knowledge base (maintained by Bento team):**
- Verified program registry (Jupiter, Orca, Raydium, Kamino, etc.)
- Known scam addresses
- Prompt injection patterns

**Claude checks for:**
1. Prompt injection patterns in the instruction text
2. Intent mismatch (prompt says "Orca" but TX targets unknown program)
3. Unknown/unverified target programs
4. Value anomalies (draining wallet, exceeding spend limit)
5. Hallucinated addresses
6. Social engineering patterns ("send now, get 2x back")

The relayer submits both `raw_score` and `reasoning_hash` (`blake3` of Claude's reasoning text) via `verdict_action`. The full reasoning text is stored off-chain in the relayer database and served via API for escalation display and dispute resolution.

---

## SDK Surface (for agent developers)

Agent developers integrate Bento with one method:

```typescript
const result = await bento.protect({
  instruction: "swap 0.5 USDC to SOL on Orca",
  ix: orcaSwapInstruction, // unsigned Solana instructions (not signed TX)
});

if (result.decision === "approved") {
  await sendTransaction(orcaSwapInstruction);
} else if (result.decision === "escalated") {
  // show reasoning to owner; owner calls approve_action or reject_action
} else {
  console.log("Blocked:", result.reasoning);
}
```

Under the hood, `protect()` handles:

1. Encrypt plaintext (user prompt + serialized instructions); compute `commitment = blake3(plaintext)`.
2. `init_action` on L1 (metadata + `total_data_len`).
3. `delegate_action` on L1 to push the Action PDA into the ER.
4. `append_payload` on ER one or more times until all chunks are written.
5. `finalize_action_building` on ER with `commitment_hash` — emits `ActionSubmitted`.
6. Wait for verdict (`ActionApproved` / `ActionEscalated` / `ActionBlocked`); for escalations the owner UI calls `approve_action` or `reject_action`.

**Important:** The SDK sends **unsigned instructions**, not signed transactions. The agent signs and broadcasts only AFTER approval. This means: (a) even if the relayer is compromised it can't execute the TX, (b) no blockhash expiry issues during analysis.

---

## Code Standards

### Anchor / Rust

- Use `#[account(zero_copy)]` + `#[repr(C, packed)]` with `AccountLoader` for PDAs containing the encrypted payload array (the `Action` PDA today).
- Use standard `#[account]` with `Account` for plain PDAs (`Config`, `Agent`).
- Use `copy_from_slice` for writing chunks into fixed-size arrays — never deserialize the full payload.
- Always validate chunk offset (`offset == data_written`) and bounds (`offset + chunk.len() <= data_len`) before writing.
- Use `saturating_add` for counter arithmetic.
- Always `drop()` (or scope-end) loaded `AccountLoader` references before accessing `to_account_info()` or loading another reference to the same account.
- Enforce maintenance gating at the top of every mutating handler via `config.is_in_maintenance()?`.
- Use the MagicBlock ER SDK helpers: `commit_accounts` for in-ER commits to L1, `commit_and_undelegate_accounts` to commit and undelegate, `#[delegate]` / `#[commit]` macros on the relevant `Accounts` structs.
- Emit granular events for every state transition: lifecycle (`InitializeConfig`, `UpdateConfig`, `RegisterAgent`, `ActiveAgent`, `DeactivateAgent`), actions (`InitAction`, `ActionSubmitted`, `ActionApproved`, `ActionEscalated`, `ActionBlocked`), reputation (`StrikeAdded`, `AgentAutoDeactivated`), escalations (`EscalationResolved`).
- Error messages should be human-readable and specific (see `BentoError`).

### PDA Seeds Convention

```
Config:  [b"bento", b"config"]
Agent:   [b"bento", b"agent", agent_wallet]
Action:  [b"bento", b"action", agent_pda, action_id_le_bytes]
```

All program PDAs are prefixed with `PREFIX_SEED = b"bento"`. There is no AllowedTarget PDA — the whitelist is inline on the Agent PDA. There is no TrustCheck PDA in the current program.

### Enums

```rust
ActionStatus (u8):
  Initialization = 0
  Pending        = 1
  Approved       = 2
  Escalated      = 3
  Blocked        = 4
  Rejected       = 5

AgentStatus (boolean-backed via From<bool>):
  Inactive = 0  (active = false)
  Active   = 1  (active = true)
```

The Action PDA's `decision: u8` field stores the same `ActionStatus` value the action was moved to at verdict — there is no separate `Decision` enum.

### Constants

```rust
DISCRIMINATOR: usize = 8        // Anchor account discriminator size
PREFIX_SEED: &[u8] = b"bento"   // first seed for all program PDAs
MAX_PAYLOAD: usize = 8192       // 8KB max encrypted payload per Action
MAX_ALLOWED_TARGETS: usize = 10 // size of inline allowed_targets array on Agent
```

Threshold / strike / EMA values are not hardcoded — they are passed in at `initialize()` and stored on the Config PDA. Suggested defaults: `escalate_threshold = 40_000`, `block_threshold = 70_000`, `max_strikes = 5`, `ema_alpha = 300`, `ema_scale = 1_000`.

---

## References

- [ENShell Showcase (ETHGlobal)](https://ethglobal.com/showcase/enshell-6t95y) — original EVM implementation
- [ENShell Docs](https://enshell.xyz/getting-started/introduction/) — architecture, smart contract, SDK, trust mesh
- [MagicBlock ER Docs](https://docs.magicblock.gg) — delegation, commit/undelegate, ephemeral rollups
- [Anchor Zero-Copy](https://www.anchor-lang.com/docs/features/zero-copy) — AccountLoader, repr(C), fixed-size arrays
- [solana-developers/anchor-zero-copy-example](https://github.com/solana-developers/anchor-zero-copy-example) — official chunked write pattern
- [mina86/solana-write-account](https://github.com/mina86/solana-write-account) — alternative chunking via helper program
