import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface AppendPayloadAccounts {
  relayer: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  action: PublicKey;
  config: PublicKey;
}

export interface AppendPayloadParams {
  offset: number;
  chunk: Buffer;
}

// 1232B tx limit minus ~251B fixed overhead (1 sig + header + 4 account
// keys × 32B + blockhash + ix scaffolding + 8B Anchor discriminator + 4B
// offset + length prefixes) leaves ~981B; 900 keeps a safety margin.
export const APPEND_PAYLOAD_DEFAULT_CHUNK_SIZE = 900;

export interface PayloadChunk {
  offset: number;
  chunk: Buffer;
}

export interface ChunkOptions {
  chunkSize?: number;
}

export const chunkAppendPayload = (
  payload: Uint8Array,
  options: ChunkOptions = {},
): PayloadChunk[] => {
  const size = options.chunkSize ?? APPEND_PAYLOAD_DEFAULT_CHUNK_SIZE;
  if (size <= 0) {
    throw new Error(`chunkSize must be > 0, got ${size}`);
  }

  const chunks: PayloadChunk[] = [];
  for (let offset = 0; offset < payload.length; offset += size) {
    const end = Math.min(offset + size, payload.length);
    chunks.push({
      offset,
      chunk: Buffer.from(payload.slice(offset, end)),
    });
  }
  return chunks;
};

export const countAppendPayloadTxs = (
  payloadLen: number,
  options: ChunkOptions = {},
): number => {
  const size = options.chunkSize ?? APPEND_PAYLOAD_DEFAULT_CHUNK_SIZE;
  if (size <= 0) {
    throw new Error(`chunkSize must be > 0, got ${size}`);
  }
  if (payloadLen < 0) {
    throw new Error(`payloadLen must be >= 0, got ${payloadLen}`);
  }
  return Math.ceil(payloadLen / size);
};

export const appendPayloadIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: AppendPayloadAccounts;
    params: AppendPayloadParams;
  },
): Promise<TransactionInstruction> => {
  return await program.methods
    .appendPayload({
      offset: payload.params.offset,
      chunk: payload.params.chunk,
    })
    .accountsPartial({
      relayer: payload.accounts.relayer,
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
      config: payload.accounts.config,
    })
    .instruction();
};

export const buildAppendPayloadIxs = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: AppendPayloadAccounts;
    encryptedPayload: Uint8Array;
    chunkSize?: number;
  },
): Promise<TransactionInstruction[]> => {
  const chunks = chunkAppendPayload(payload.encryptedPayload, {
    chunkSize: payload.chunkSize,
  });
  return Promise.all(
    chunks.map((c) =>
      appendPayloadIx(program, {
        accounts: payload.accounts,
        params: { offset: c.offset, chunk: c.chunk },
      }),
    ),
  );
};
