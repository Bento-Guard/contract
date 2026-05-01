import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Contract } from "../target/types/contract";
import { OPERATOR_KEYPAIR, RELAYER_KEYPAIR } from "./accounts";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
    actionStatus,
    delegateAgentIx,
    generateX25519Keypair,
    initActionIx,
    initializeIx,
    InitializeParams,
    registerAgentIx,
    RegisterAgentParams,
    seeds,
    toEncryptionKeyBytes,
    updateConfigIx,
    updateMaintenanceIx,
} from "../sdk";

describe("contract", () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());
    const provider = anchor.getProvider();
    const providerEphemeralRollup = new anchor.AnchorProvider(
        new anchor.web3.Connection(
            process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
            {
                wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app/",
            },
        ),
        anchor.Wallet.local(),
    );
    const routerConnection = new anchor.web3.Connection(
        process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app",
        {
            wsEndpoint: process.env.ROUTER_WS_ENDPOINT || "wss://devnet-router.magicblock.app",
        },
    );

    console.log("========================================");
    console.log("         Loading Configuration");
    console.log("========================================");

    const program = anchor.workspace.contract as Program<Contract>;
    const connection = new Connection(provider.connection.rpcEndpoint);
    const ephemeralRollupConnection = new Connection(
        providerEphemeralRollup.connection.rpcEndpoint,
    );

    console.log("Base Connection: ", connection.rpcEndpoint);
    console.log("Ephemeral Rollup Connection: ", ephemeralRollupConnection.rpcEndpoint);

    const operatorKeypair = Keypair.fromSecretKey(OPERATOR_KEYPAIR);
    const relayerKeypair = Keypair.fromSecretKey(RELAYER_KEYPAIR);
    const relayerEncryptionKeypair = generateX25519Keypair();

    // Owner + agent wallet shared across the action-flow tests.
    // The user must run register_agent (delegation flow) on these before
    // init_action / approve_action / reject_action below can succeed.
    const ownerKeypair = Keypair.generate();
    const agentWalletKeypair = Keypair.generate();

    const [configPda] = PublicKey.findProgramAddressSync(seeds.config(), program.programId);

    console.log("\n========================================");
    console.log("           Accounts loaded");
    console.log("========================================");
    console.log(`  Operator Pubkey         : ${operatorKeypair.publicKey.toBase58()}`);
    console.log(`  Relayer Pubkey          : ${relayerKeypair.publicKey.toBase58()}`);
    console.log(
        `  Relayer Encryption PubKey: ${Buffer.from(relayerEncryptionKeypair.publicKey).toString("hex")}`,
    );
    console.log(`  Owner Pubkey            : ${ownerKeypair.publicKey.toBase58()}`);
    console.log(`  Agent Wallet Pubkey     : ${agentWalletKeypair.publicKey.toBase58()}`);

    // Airdrop the operator, relayer, owner, and agent wallet.
    beforeEach(async () => {
        await Promise.all([
            provider.connection.requestAirdrop(operatorKeypair.publicKey, 100_000_000),
            provider.connection.requestAirdrop(relayerKeypair.publicKey, 100_000_000),
            provider.connection.requestAirdrop(ownerKeypair.publicKey, 100_000_000),
            provider.connection.requestAirdrop(agentWalletKeypair.publicKey, 100_000_000),
        ]);
    });

    xdescribe("Initialization Config", () => {
        it("Success initialize config", async () => {
            const initializeConfigParams: InitializeParams = {
                relayer: relayerKeypair.publicKey,
                relayerEncryptionKey: toEncryptionKeyBytes(relayerEncryptionKeypair.publicKey),
                escalateThreshold: 40_000,
                blockThreshold: 70_000,
                maxStrikes: 5,
                emaAlpha: 300,
                emaScale: 1_000,
            };

            const ix = await initializeIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    config: configPda,
                },
                params: initializeConfigParams,
            });

            const tx = new Transaction().add(ix);
            const signature = await provider.sendAndConfirm!(tx, [operatorKeypair]);
            console.log(`  Initialize tx signature: ${signature}`);

            const config = await program.account.config.fetch(configPda);

            expect(config.operator.toBase58()).to.equal(operatorKeypair.publicKey.toBase58());
            expect(config.relayer.toBase58()).to.equal(relayerKeypair.publicKey.toBase58());
            expect(config.relayerEncryptionKey).to.deep.equal(
                initializeConfigParams.relayerEncryptionKey,
            );
            expect(config.escalateThreshold).to.equal(initializeConfigParams.escalateThreshold);
            expect(config.blockThreshold).to.equal(initializeConfigParams.blockThreshold);
            expect(config.maxStrikes).to.equal(initializeConfigParams.maxStrikes);
            expect(config.emaAlpha).to.equal(initializeConfigParams.emaAlpha);
            expect(config.emaScale).to.equal(initializeConfigParams.emaScale);
            expect(config.totalAgents.toNumber()).to.equal(0);
            expect(config.maintenance).to.equal(false);
        });
    });

    describe("Update Config", () => {
        it("Updates a single field (escalate_threshold) and leaves others untouched", async () => {
            const before = await program.account.config.fetch(configPda);

            const newEscalate = before.escalateThreshold + 1;

            const ix = await updateConfigIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    config: configPda,
                },
                params: {
                    relayer: null,
                    relayerEncryptionKey: null,
                    escalateThreshold: newEscalate,
                    blockThreshold: null,
                    maxStrikes: null,
                    emaAlpha: null,
                    emaScale: null,
                },
            });

            const tx = new Transaction().add(ix);
            await provider.sendAndConfirm!(tx, [operatorKeypair]);

            const after = await program.account.config.fetch(configPda);
            expect(after.escalateThreshold).to.equal(newEscalate);
            expect(after.relayer.toBase58()).to.equal(before.relayer.toBase58());
            expect(after.relayerEncryptionKey).to.deep.equal(before.relayerEncryptionKey);
            expect(after.blockThreshold).to.equal(before.blockThreshold);
            expect(after.maxStrikes).to.equal(before.maxStrikes);
            expect(after.emaAlpha).to.equal(before.emaAlpha);
            expect(after.emaScale).to.equal(before.emaScale);
        });

        it("Rotates the relayer pubkey and the relayer encryption key together", async () => {
            const newRelayer = Keypair.generate();
            const newEncryption = generateX25519Keypair();

            const ix = await updateConfigIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    config: configPda,
                },
                params: {
                    relayer: newRelayer.publicKey,
                    relayerEncryptionKey: toEncryptionKeyBytes(newEncryption.publicKey),
                    escalateThreshold: null,
                    blockThreshold: null,
                    maxStrikes: null,
                    emaAlpha: null,
                    emaScale: null,
                },
            });

            await provider.sendAndConfirm!(new Transaction().add(ix), [operatorKeypair]);

            const after = await program.account.config.fetch(configPda);
            expect(after.relayer.toBase58()).to.equal(newRelayer.publicKey.toBase58());
            expect(after.relayerEncryptionKey).to.deep.equal(
                toEncryptionKeyBytes(newEncryption.publicKey),
            );

            // Restore the original relayer so downstream tests use the keypair we control.
            const restoreIx = await updateConfigIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    config: configPda,
                },
                params: {
                    relayer: relayerKeypair.publicKey,
                    relayerEncryptionKey: toEncryptionKeyBytes(relayerEncryptionKeypair.publicKey),
                    escalateThreshold: null,
                    blockThreshold: null,
                    maxStrikes: null,
                    emaAlpha: null,
                    emaScale: null,
                },
            });
            await provider.sendAndConfirm!(new Transaction().add(restoreIx), [operatorKeypair]);
        });

        it("Updates every field in a single call", async () => {
            const params = {
                relayer: relayerKeypair.publicKey,
                relayerEncryptionKey: toEncryptionKeyBytes(relayerEncryptionKeypair.publicKey),
                escalateThreshold: 45_000,
                blockThreshold: 75_000,
                maxStrikes: 7,
                emaAlpha: 250,
                emaScale: 1_000,
            };

            const ix = await updateConfigIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    config: configPda,
                },
                params,
            });
            await provider.sendAndConfirm!(new Transaction().add(ix), [operatorKeypair]);

            const after = await program.account.config.fetch(configPda);
            expect(after.relayer.toBase58()).to.equal(params.relayer.toBase58());
            expect(after.relayerEncryptionKey).to.deep.equal(params.relayerEncryptionKey);
            expect(after.escalateThreshold).to.equal(params.escalateThreshold);
            expect(after.blockThreshold).to.equal(params.blockThreshold);
            expect(after.maxStrikes).to.equal(params.maxStrikes);
            expect(after.emaAlpha).to.equal(params.emaAlpha);
            expect(after.emaScale).to.equal(params.emaScale);
        });

        it("Rejects update_config from a non-operator signer", async () => {
            const intruder = Keypair.generate();

            // Fund the intruder so the tx can pay fees.
            const airdrop = await connection.requestAirdrop(
                intruder.publicKey,
                anchor.web3.LAMPORTS_PER_SOL,
            );
            await connection.confirmTransaction(airdrop, "confirmed");

            const ix = await updateConfigIx(program, {
                accounts: {
                    operator: intruder.publicKey,
                    config: configPda,
                },
                params: {
                    relayer: null,
                    relayerEncryptionKey: null,
                    escalateThreshold: 99_999,
                    blockThreshold: null,
                    maxStrikes: null,
                    emaAlpha: null,
                    emaScale: null,
                },
            });

            try {
                await provider.sendAndConfirm!(new Transaction().add(ix), [intruder]);
                expect.fail("update_config should have failed for a non-operator signer");
            } catch (err: any) {
                expect(String(err)).to.match(/InvalidOperator|0x1771|constraint/i);
            }
        });
    });

    describe("Update Maintenance", () => {
        it("Operator can toggle maintenance ON", async () => {
            const ix = await updateMaintenanceIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    config: configPda,
                },
                params: { maintenance: true },
            });
            await provider.sendAndConfirm!(new Transaction().add(ix), [operatorKeypair]);

            const config = await program.account.config.fetch(configPda);
            expect(config.maintenance).to.equal(true);
        });

        it("Operator can toggle maintenance OFF", async () => {
            const ix = await updateMaintenanceIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    config: configPda,
                },
                params: { maintenance: false },
            });
            await provider.sendAndConfirm!(new Transaction().add(ix), [operatorKeypair]);

            const config = await program.account.config.fetch(configPda);
            expect(config.maintenance).to.equal(false);
        });

        it("Rejects update_maintenance from a non-operator signer", async () => {
            const intruder = Keypair.generate();
            const airdrop = await connection.requestAirdrop(
                intruder.publicKey,
                anchor.web3.LAMPORTS_PER_SOL,
            );
            await connection.confirmTransaction(airdrop, "confirmed");

            const ix = await updateMaintenanceIx(program, {
                accounts: {
                    operator: intruder.publicKey,
                    config: configPda,
                },
                params: { maintenance: true },
            });

            try {
                await provider.sendAndConfirm!(new Transaction().add(ix), [intruder]);
                expect.fail("update_maintenance should have failed for a non-operator signer");
            } catch (err: any) {
                expect(String(err)).to.match(/constraint|0x|InvalidOperator/i);
            }
        });
    });

    describe("Register Agent", () => {
        it("Success Register Agent", async () => {
            const registerAgentParams: RegisterAgentParams = {
                spendLimit: new anchor.BN(1_000),
            };

            const [agentPda] = PublicKey.findProgramAddressSync(
                seeds.agent(agentWalletKeypair.publicKey),
                program.programId,
            );

            // Add local validator identity to the remaining accounts if running on localnet
            const validatorAccount =
                ephemeralRollupConnection.rpcEndpoint.includes("localhost") ||
                ephemeralRollupConnection.rpcEndpoint.includes("127.0.0.1")
                    ? new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev")
                    : undefined;

            const registerIx = await registerAgentIx(program, {
                accounts: {
                    owner: ownerKeypair.publicKey,
                    agentWallet: agentWalletKeypair.publicKey,
                    agent: agentPda,
                    config: configPda,
                },
                params: registerAgentParams,
            });

            const delegateIx = await delegateAgentIx(program, {
                accounts: {
                    owner: ownerKeypair.publicKey,
                    agent: agentPda,
                    config: configPda,
                    ownerProgram: program.programId,
                },
                validator: validatorAccount,
            });

            console.log("Agent PDA: ", agentPda.toBase58())
            const tx = new Transaction().add(registerIx).add(delegateIx);
            const txHash = await provider.sendAndConfirm!(tx, [ownerKeypair, agentWalletKeypair]);
            console.log(`Register + Delegate Agent txHash: ${txHash}`);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // User actions on mainchain.
    //
    // Prerequisite (handled by the user's delegation tests):
    //   register_agent(owner, agent_wallet) must have run so that `agentPda`
    //   exists on L1 with owner = ownerKeypair, agent_wallet = agentWalletKeypair,
    //   active = true.
    // ─────────────────────────────────────────────────────────────────────────
    xdescribe("Init Action (mainchain)", () => {
        const actionId = new anchor.BN(1);
        const totalDataLen = 256;

        it("Owner + agent_wallet co-sign init_action and create the Action PDA", async () => {
            const [actionPda] = PublicKey.findProgramAddressSync(
                seeds.action(agentPda, actionId),
                program.programId,
            );

            const targetProgram = Keypair.generate().publicKey;
            const value = new anchor.BN(1_000);

            const ix = await initActionIx(program, {
                accounts: {
                    owner: ownerKeypair.publicKey,
                    agentWallet: agentWalletKeypair.publicKey,
                    agent: agentPda,
                    action: actionPda,
                    config: configPda,
                },
                params: {
                    targetProgram,
                    value,
                    actionId,
                    totalDataLen,
                },
            });

            const tx = new Transaction().add(ix);
            const signature = await provider.sendAndConfirm!(tx, [
                ownerKeypair,
                agentWalletKeypair,
            ]);
            console.log(`  Init action tx signature: ${signature}`);

            const action = await program.account.action.fetch(actionPda);
            expect(action.agent.toBase58()).to.equal(agentPda.toBase58());
            expect(action.actionId.toString()).to.equal(actionId.toString());
            expect(action.targetProgram.toBase58()).to.equal(targetProgram.toBase58());
            expect(action.value.toString()).to.equal(value.toString());
            expect(action.dataLen).to.equal(totalDataLen);
            expect(action.dataWritten).to.equal(0);
            expect(action.status).to.equal(actionStatus.initialization);
        });
    });
});
