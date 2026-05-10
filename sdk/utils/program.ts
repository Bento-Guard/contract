import * as anchor from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";
import contractIdlJson from "../../target/idl/contract.json";

export const DEFAULT_PROGRAM_ID = "A5vQdPeJH2Yn72RmXHyrFjErUTqPwX83e6of4LBchEbG";

const idlJsonStr = JSON.stringify(contractIdlJson);
const idlJson = JSON.parse(idlJsonStr);

export const getProgram = (
  connection: Connection,
  programId: string = DEFAULT_PROGRAM_ID
): anchor.Program<Contract> => {
  idlJson.address = programId;

  return new anchor.Program(idlJson, {
    connection: new anchor.web3.Connection(connection.rpcEndpoint),
  });
};
