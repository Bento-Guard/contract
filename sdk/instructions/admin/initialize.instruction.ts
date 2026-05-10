import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Contract } from "../../../target/types/contract";

export interface InitializeAccounts {
  operator: PublicKey;
  config: PublicKey;
}

export interface InitializeParams {
  relayer: PublicKey;
  relayerEncryptionKey: number[];
  escalateThreshold: number;
  blockThreshold: number;
  maxStrikes: number;
  emaAlpha: number;
  emaScale: number;
}

export const initializeIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: InitializeAccounts;
    params: InitializeParams;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .initialize({
      relayer: payload.params.relayer,
      relayerEncryptionKey: payload.params.relayerEncryptionKey,
      escalateThreshold: payload.params.escalateThreshold,
      blockThreshold: payload.params.blockThreshold,
      maxStrikes: payload.params.maxStrikes,
      emaAlpha: payload.params.emaAlpha,
      emaScale: payload.params.emaScale,
    })
    .accountsPartial({
      operator: payload.accounts.operator,
      config: payload.accounts.config,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
};
