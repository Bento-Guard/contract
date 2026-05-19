import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Contract } from "../target/types/contract";
import { OPERATOR_KEYPAIR, OWNER_AGENT_KEYPAIR, RELAYER_KEYPAIR } from "./accounts";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import {
    GetCommitmentSignature,
    MAGIC_CONTEXT_ID,
    MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
    actionStatus,
    activeAgentIx,
    appendPayloadIx,
    APPEND_PAYLOAD_DEFAULT_CHUNK_SIZE,
    approveActionIx,
    chunkAppendPayload,
    commitmentHashAsArray,
    countAppendPayloadTxs,
    deactivateAgentIx,
    decodeActionPayload,
    decryptFromAgent,
    delegateActionIx,
    delegateAgentIx,
    deriveMagicFeeVault,
    encodeActionPayload,
    encryptForRelayer,
    finalizeActionBuildingIx,
    generateX25519Keypair,
    initActionIx,
    initializeIx,
    InitializeParams,
    registerAgentIx,
    RegisterAgentParams,
    rejectActionIx,
    seeds,
    toEncryptionKeyBytes,
    updateAgentProgramTargetIx,
    updateConfigIx,
    updateMaintenanceIx,
    verdictActionIx,
} from "../sdk";

describe("contract", () => {
    // Use `finalized` everywhere so each step (register, delegate, deactivate,
    // reactivate, plus the ER → L1 commit) is fully settled before the next test
    // reads from either chain. This avoids "account does not exist" races where
    // the ER hasn't yet ingested a freshly-delegated PDA.
    const FINALIZED_OPTS: anchor.web3.ConfirmOptions = {
        commitment: "finalized",
        preflightCommitment: "finalized",
    };

    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());
    const baseProvider = anchor.getProvider() as anchor.AnchorProvider;
    const provider = new anchor.AnchorProvider(
        new anchor.web3.Connection(baseProvider.connection.rpcEndpoint, "finalized"),
        baseProvider.wallet,
        FINALIZED_OPTS,
    );
    anchor.setProvider(provider);

    const providerEphemeralRollup = new anchor.AnchorProvider(
        new anchor.web3.Connection(
            process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
            {
                wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app/",
                commitment: "finalized",
            },
        ),
        anchor.Wallet.local(),
        FINALIZED_OPTS,
    );

    console.log("========================================");
    console.log("         Loading Configuration");
    console.log("========================================");

    const workspaceProgram = anchor.workspace.contract as Program<Contract>;
    const program = new Program<Contract>(workspaceProgram.idl, provider);
    const ephemeralProgram = new Program<Contract>(workspaceProgram.idl, providerEphemeralRollup);
    const connection = new Connection(provider.connection.rpcEndpoint, "finalized");
    const ephemeralRollupConnection = new Connection(
        providerEphemeralRollup.connection.rpcEndpoint,
        "finalized",
    );

    console.log("Base Connection: ", connection.rpcEndpoint);
    console.log("Ephemeral Rollup Connection: ", ephemeralRollupConnection.rpcEndpoint);

    const operatorKeypair = Keypair.fromSecretKey(OPERATOR_KEYPAIR);
    const relayerKeypair = Keypair.fromSecretKey(RELAYER_KEYPAIR);
    const relayerEncryptionKeypair = generateX25519Keypair();

    // Owner + agent wallet shared across the action-flow tests.
    // The user must run register_agent (delegation flow) on these before
    // init_action / approve_action / reject_action below can succeed.
    const ownerKeypair = Keypair.fromSecretKey(OWNER_AGENT_KEYPAIR);
    const agentWalletKeypair = Keypair.generate();

    const [configPda] = PublicKey.findProgramAddressSync(seeds.config(), program.programId);
    const [agentPda] = PublicKey.findProgramAddressSync(
        seeds.agent(agentWalletKeypair.publicKey),
        program.programId,
    );

    // `provider.sendAndConfirm` always partialSigns with the AnchorProvider's
    // wallet keypair (~/.config/solana/id.json on localnet), which throws
    // "unknown signer" whenever the feePayer differs from that wallet — which
    // is always the case here, because the tests use the bundled relayer /
    // operator keypairs from tests/accounts. Use this helper instead: it
    // signs only with the keypairs we explicitly provide.
    const sendL1 = (
        tx: Transaction,
        signers: Keypair[],
        opts: anchor.web3.ConfirmOptions = FINALIZED_OPTS,
    ) => {
        if (!tx.feePayer && signers.length > 0) tx.feePayer = signers[0].publicKey;
        return sendAndConfirmTransaction(connection, tx, signers, {
            commitment: opts.commitment,
            preflightCommitment: opts.preflightCommitment,
        });
    };

    // The canonical `magic_fee_vault` PDA is derived from the validator that
    // owns the delegation record of any delegated account. We read it lazily
    // after register_agent + delegate_agent succeed, and reuse it for every
    // subsequent commit handler. The same vault is shared by all accounts
    // delegated to the same validator.
    let magicFeeVault: PublicKey | undefined;
    const ensureMagicFeeVault = async (): Promise<PublicKey> => {
        if (magicFeeVault) return magicFeeVault;
        const { magicFeeVault: pda } = await deriveMagicFeeVault(connection, agentPda);
        magicFeeVault = pda;
        // Fund the vault so commits have lamports to debit. Cheap on localnet,
        // ~harmless on devnet — re-runs of the test top up incrementally.
        // 0.05 SOL covers ~1000 commits at typical per-commit lamport cost; we
        // intentionally keep this well below the 0.1 SOL per-test airdrop so
        // the relayer still has room to pay its own ER transaction fees.
        const fundIx = SystemProgram.transfer({
            fromPubkey: relayerKeypair.publicKey,
            toPubkey: pda,
            lamports: 0.05 * LAMPORTS_PER_SOL,
        });
        await sendAndConfirmTransaction(connection, new Transaction().add(fundIx), [
            relayerKeypair,
        ]);
        console.log(`Funded magic_fee_vault ${pda.toBase58()} with 0.05 SOL`);
        return pda;
    };

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

    // Read the agent account directly via `getAccountInfo` and decode through
    // Anchor's coder. While the Agent PDA is delegated to the ER, its L1 owner
    // is the delegation program; this avoids Anchor's strict owner check on
    // `program.account.agent.fetch`.
    const readAgent = async (
        conn: Connection,
        commitment: anchor.web3.Commitment = "confirmed",
    ) => {
        const info = await conn.getAccountInfo(agentPda, commitment);
        if (!info) return { exists: false as const };
        const decoded = program.coder.accounts.decode("agent", info.data);
        return {
            exists: true as const,
            owner: info.owner.toBase58(),
            active: decoded.active as boolean,
        };
    };

    // Poll only the ER for the expected `active` flag. The ER reflects state
    // changes immediately, so this should converge in 1-2 polls.
    const waitForErActive = async (expected: boolean, timeoutMs = 30_000) => {
        const start = Date.now();
        let last: boolean | undefined;
        let attempt = 0;
        while (Date.now() - start < timeoutMs) {
            attempt += 1;
            const er = await readAgent(ephemeralRollupConnection);
            last = er.exists ? er.active : undefined;
            console.log(`🚀 waitForErActive[#${attempt}] expected=${expected} ER=${last}`);
            if (last === expected) return;
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        throw new Error(`Timed out waiting for ER agent.active === ${expected} (ER=${last})`);
    };

    describe("Initialization Config", () => {
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
            const signature = await sendL1(tx, [operatorKeypair]);
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

    xdescribe("Update Config", () => {
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
            await sendL1(tx, [operatorKeypair]);

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

            await sendL1(new Transaction().add(ix), [operatorKeypair]);

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
            await sendL1(new Transaction().add(restoreIx), [operatorKeypair]);
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
            await sendL1(new Transaction().add(ix), [operatorKeypair]);

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
                await sendL1(new Transaction().add(ix), [intruder]);
                expect.fail("update_config should have failed for a non-operator signer");
            } catch (err: any) {
                expect(String(err)).to.match(/InvalidOperator|0x1771|constraint/i);
            }
        });
    });

    xdescribe("Update Maintenance", () => {
        it("Operator can toggle maintenance ON", async () => {
            const ix = await updateMaintenanceIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    config: configPda,
                },
                params: { maintenance: true },
            });
            await sendL1(new Transaction().add(ix), [operatorKeypair]);

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
            await sendL1(new Transaction().add(ix), [operatorKeypair]);

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
                await sendL1(new Transaction().add(ix), [intruder]);
                expect.fail("update_maintenance should have failed for a non-operator signer");
            } catch (err: any) {
                expect(String(err)).to.match(/constraint|0x|InvalidOperator/i);
            }
        });
    });

    describe("Register Agent", () => {
        // Local validator identity is required as the first remaining account when
        // delegating on localnet (the magicblock validator key). On devnet/mainnet
        // the ER picks the validator automatically.
        const validatorAccount =
            ephemeralRollupConnection.rpcEndpoint.includes("localhost") ||
            ephemeralRollupConnection.rpcEndpoint.includes("127.0.0.1")
                ? new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev")
                : undefined;

        it("Success Register Agent", async () => {
            const registerAgentParams: RegisterAgentParams = {
                spendLimit: new anchor.BN(1_000),
            };

            const registerIx = await registerAgentIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agentWallet: agentWalletKeypair.publicKey,
                    agent: agentPda,
                    config: configPda,
                },
                params: registerAgentParams,
            });

            const delegateIx = await delegateAgentIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agent: agentPda,
                    config: configPda,
                    ownerProgram: program.programId,
                },
                validator: validatorAccount,
            });

            console.log("Agent PDA: ", agentPda.toBase58());
            const tx = new Transaction().add(registerIx).add(delegateIx);
            tx.feePayer = relayerKeypair.publicKey;
            const txHash = await sendL1(
                tx,
                [relayerKeypair, ownerKeypair],
                FINALIZED_OPTS,
            );
            console.log(`Register + Delegate Agent txHash: ${txHash}`);

            // Wait until the ER has actually ingested the freshly-delegated
            // Agent PDA before the next test runs. Without this, subsequent
            // ER reads can race the delegation event and see
            // "Account does not exist" even though L1 is finalized.
            for (let attempt = 0; attempt < 30; attempt++) {
                const onEr = await ephemeralRollupConnection.getAccountInfo(
                    agentPda,
                    "finalized",
                );
                if (onEr) break;
                await new Promise((resolve) => setTimeout(resolve, 1_000));
            }

            const agentOnL1 = await program.account.agent.fetch(agentPda);
            expect(agentOnL1.active).to.equal(true);
            const agentOnEr = await ephemeralProgram.account.agent.fetch(agentPda);
            expect(agentOnEr.active).to.equal(true);
        });

        // The deactivate / active tests only assert the ER state. The L1
        // writeback through `commit_accounts` is best-effort — on a local
        // `mb-test-validator` the `ephemeral-validator` batches commits
        // before submitting them, so L1 propagation can lag by minutes. The
        // commit signature is logged so it can be looked up on the base-chain
        // explorer if needed, but we don't block the test on it.

        xit("Deactivate Agent (ER → commit Agent state back to L1)", async () => {
            // ER pre-condition: agent is currently active.
            const before = await readAgent(ephemeralRollupConnection);
            expect(before.active).to.equal(true);

            const ix = await deactivateAgentIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agent: agentPda,
                    config: configPda,
                    magicProgram: MAGIC_PROGRAM_ID,
                    magicContext: MAGIC_CONTEXT_ID,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
            });

            const tx = new Transaction().add(ix);
            tx.feePayer = relayerKeypair.publicKey;
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                tx,
                [relayerKeypair, ownerKeypair],
                { skipPreflight: true, commitment: "finalized", preflightCommitment: "finalized" },
            );
            console.log(`Deactivate Agent txHash (ER): ${txHash}`);

            const commitSig = await GetCommitmentSignature(txHash, ephemeralRollupConnection);
            console.log(`Commit signature on base chain: ${commitSig}`);

            // Only assert the ER reflects the deactivation. L1 propagation is
            // observable via the commit signature logged above.
            await waitForErActive(false);
        });

        xit("Active Agent (ER → commit Agent state back to L1)", async () => {
            // ER pre-condition: agent is currently inactive.
            const before = await readAgent(ephemeralRollupConnection);
            expect(before.active).to.equal(false);

            const ix = await activeAgentIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agent: agentPda,
                    config: configPda,
                    magicProgram: MAGIC_PROGRAM_ID,
                    magicContext: MAGIC_CONTEXT_ID,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
            });

            const tx = new Transaction().add(ix);
            tx.feePayer = relayerKeypair.publicKey;
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                tx,
                [relayerKeypair, ownerKeypair],
                { skipPreflight: true, commitment: "finalized", preflightCommitment: "finalized" },
            );
            console.log(`Active Agent txHash (ER): ${txHash}`);

            const commitSig = await GetCommitmentSignature(txHash, ephemeralRollupConnection);
            console.log(`Commit signature on base chain: ${commitSig}`);

            // Only assert the ER reflects the re-activation.
            await waitForErActive(true);
        });

        // `update_agent_program_target` runs on the ER (the Agent PDA is
        // delegated there). It adds a new entry to `allowed_targets` if the
        // target isn't already present, or toggles the `allowed` flag of the
        // existing entry. Like deactivate/active, it then `commit_accounts`
        // back to L1 — we only assert ER state and just log the commit sig.
        const sharedTargetProgram = Keypair.generate().publicKey;

        xit("Update Agent Program Target — add new target (ER)", async () => {
            // Pre-condition: the target is not yet in the agent's whitelist.
            const beforeOnEr = await ephemeralProgram.account.agent.fetch(agentPda);
            const beforeMatch = beforeOnEr.allowedTargets.find(
                (t) => t.target.toBase58() === sharedTargetProgram.toBase58(),
            );
            expect(beforeMatch).to.equal(undefined);

            const ix = await updateAgentProgramTargetIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agentWallet: agentWalletKeypair.publicKey,
                    agent: agentPda,
                    config: configPda,
                    magicProgram: MAGIC_PROGRAM_ID,
                    magicContext: MAGIC_CONTEXT_ID,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
                params: {
                    target: {
                        target: sharedTargetProgram,
                        allowed: true,
                    },
                },
            });

            const tx = new Transaction().add(ix);
            tx.feePayer = relayerKeypair.publicKey;
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                tx,
                [relayerKeypair, ownerKeypair, agentWalletKeypair],
                { skipPreflight: true, commitment: "finalized", preflightCommitment: "finalized" },
            );
            console.log(`Update Agent Program Target (add) txHash (ER): ${txHash}`);

            const commitSig = await GetCommitmentSignature(txHash, ephemeralRollupConnection);
            console.log(`Commit signature on base chain: ${commitSig}`);

            // Verify the ER agent's allowed_targets now contains the entry
            // with `allowed = true`.
            const afterOnEr = await ephemeralProgram.account.agent.fetch(agentPda);
            const matches = afterOnEr.allowedTargets.filter(
                (t) => t.target.toBase58() === sharedTargetProgram.toBase58(),
            );
            expect(matches.length).to.equal(1);
            expect(matches[0].allowed).to.equal(true);
        });

        xit("Update Agent Program Target — toggle existing target's allowed flag (ER)", async () => {
            // Pre-condition: the entry from the previous test exists with allowed = true.
            const beforeOnEr = await ephemeralProgram.account.agent.fetch(agentPda);
            const beforeMatches = beforeOnEr.allowedTargets.filter(
                (t) => t.target.toBase58() === sharedTargetProgram.toBase58(),
            );
            expect(beforeMatches.length).to.equal(1);
            expect(beforeMatches[0].allowed).to.equal(true);

            const ix = await updateAgentProgramTargetIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agentWallet: agentWalletKeypair.publicKey,
                    agent: agentPda,
                    config: configPda,
                    magicProgram: MAGIC_PROGRAM_ID,
                    magicContext: MAGIC_CONTEXT_ID,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
                params: {
                    target: {
                        target: sharedTargetProgram,
                        allowed: false,
                    },
                },
            });

            const tx = new Transaction().add(ix);
            tx.feePayer = relayerKeypair.publicKey;
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                tx,
                [relayerKeypair, ownerKeypair, agentWalletKeypair],
                { skipPreflight: true, commitment: "finalized", preflightCommitment: "finalized" },
            );
            console.log(`Update Agent Program Target (toggle) txHash (ER): ${txHash}`);

            const commitSig = await GetCommitmentSignature(txHash, ephemeralRollupConnection);
            console.log(`Commit signature on base chain: ${commitSig}`);

            // Verify the existing entry was toggled (NOT duplicated).
            const afterOnEr = await ephemeralProgram.account.agent.fetch(agentPda);
            const matches = afterOnEr.allowedTargets.filter(
                (t) => t.target.toBase58() === sharedTargetProgram.toBase58(),
            );
            expect(matches.length).to.equal(1);
            expect(matches[0].allowed).to.equal(false);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Action Flow: init (L1) → delegate (L1) → append (ER) → finalize (ER)
    //
    // Mock input mirrors the SDK contract from docs/SUMMARY.md:
    //   • User Prompt    : "Send 10 SOL to another wallet"
    //   • TX Payload     : SystemProgram.transfer(agentWallet → recipient, 10 SOL)
    //
    // The plaintext (prompt + serialized ix) is encrypted to the relayer's
    // x25519 public key with ChaCha20-Poly1305. The on-chain blob is
    // ephemeralPubKey || nonce || ciphertext. The blake3 commitment of the
    // *plaintext* is supplied at finalize so the relayer can detect tampering
    // after decryption.
    //
    // Prerequisite: the Register Agent describe above already created and
    // delegated `agentPda`. We re-use it here.
    // ─────────────────────────────────────────────────────────────────────────
    describe("Action Flow (Init → Delegate → Append → Finalize)", () => {
        const validatorAccount =
            ephemeralRollupConnection.rpcEndpoint.includes("localhost") ||
            ephemeralRollupConnection.rpcEndpoint.includes("127.0.0.1")
                ? new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev")
                : undefined;

        const actionId = new anchor.BN(1);
        const recipientKeypair = Keypair.generate();
        const userPrompt = "Send 10 SOL to another wallet";
        const transferLamports = new anchor.BN(10).mul(new anchor.BN(LAMPORTS_PER_SOL));

        // Chunk size and chunk-count math live in the SDK so production
        // callers (not just this test) get consistent behavior. See
        // sdk/instructions/append-payload.instruction.ts for the byte budget.
        const CHUNK_SIZE = APPEND_PAYLOAD_DEFAULT_CHUNK_SIZE;

        let actionPda: PublicKey;
        let transferIx: TransactionInstruction;
        let plaintextBytes: Uint8Array;
        let encryptedPayload: Uint8Array;
        let commitment: number[];

        before(() => {
            [actionPda] = PublicKey.findProgramAddressSync(
                seeds.action(agentPda, actionId),
                program.programId,
            );

            transferIx = SystemProgram.transfer({
                fromPubkey: agentWalletKeypair.publicKey,
                toPubkey: recipientKeypair.publicKey,
                lamports: BigInt(transferLamports.toString()),
            });

            // Build a v0 VersionedTransaction the relayer can deserialize and
            // execute as-is. The blockhash is a placeholder — the relayer
            // re-fetches a fresh one before signing/submitting.
            const message = new TransactionMessage({
                payerKey: agentWalletKeypair.publicKey,
                recentBlockhash: PublicKey.default.toBase58(),
                instructions: [transferIx],
            }).compileToV0Message();
            const vtx = new VersionedTransaction(message);
            const txBytes = vtx.serialize();

            plaintextBytes = encodeActionPayload({
                prompt: userPrompt,
                tx: txBytes,
            });

            const enc = encryptForRelayer({
                plaintext: plaintextBytes,
                relayerPublicKey: relayerEncryptionKeypair.publicKey,
            });
            encryptedPayload = enc.payload;
            commitment = commitmentHashAsArray(plaintextBytes);

            console.log("\n----- Action mock input -----");
            console.log(`  Action PDA              : ${actionPda.toBase58()}`);
            console.log(`  Recipient               : ${recipientKeypair.publicKey.toBase58()}`);
            console.log(`  User Prompt             : ${userPrompt}`);
            console.log(`  Transfer Lamports       : ${transferLamports.toString()}`);
            console.log(`  Plaintext bytes         : ${plaintextBytes.length}`);
            console.log(`  Encrypted payload bytes : ${encryptedPayload.length}`);
            console.log(`  Commitment hash (hex)   : ${Buffer.from(commitment).toString("hex")}`);
        });

        it("init_action (L1) + delegate_action (L1) — create Action PDA and push to ER", async () => {
            const initIx = await initActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    agentWallet: agentWalletKeypair.publicKey,
                    agent: agentPda,
                    action: actionPda,
                    config: configPda,
                },
                params: {
                    targetProgram: SystemProgram.programId,
                    value: transferLamports,
                    actionId,
                    totalDataLen: encryptedPayload.length,
                },
            });

            const delegateIx = await delegateActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agent: agentPda,
                    action: actionPda,
                    config: configPda,
                    ownerProgram: program.programId,
                },
                validator: validatorAccount,
            });

            const tx = new Transaction().add(initIx).add(delegateIx);
            tx.feePayer = relayerKeypair.publicKey;
            const txHash = await sendL1(
                tx,
                [relayerKeypair, ownerKeypair, agentWalletKeypair],
                FINALIZED_OPTS,
            );
            console.log(`Init + Delegate Action txHash: ${txHash}`);

            // Wait until the ER has actually ingested the freshly-delegated
            // Action PDA (mirrors the agent ingestion poll above).
            for (let attempt = 0; attempt < 30; attempt++) {
                const onEr = await ephemeralRollupConnection.getAccountInfo(
                    actionPda,
                    "finalized",
                );
                if (onEr) break;
                await new Promise((resolve) => setTimeout(resolve, 1_000));
            }

            const actionOnEr = await ephemeralProgram.account.action.fetch(actionPda);
            expect(actionOnEr.agent.toBase58()).to.equal(agentPda.toBase58());
            expect(actionOnEr.actionId.toString()).to.equal(actionId.toString());
            expect(actionOnEr.targetProgram.toBase58()).to.equal(
                SystemProgram.programId.toBase58(),
            );
            expect(actionOnEr.value.toString()).to.equal(transferLamports.toString());
            expect(actionOnEr.dataLen).to.equal(encryptedPayload.length);
            expect(actionOnEr.dataWritten).to.equal(0);
            expect(actionOnEr.status).to.equal(actionStatus.initialization);
        });

        it("append_payload (ER) — write encrypted chunks sequentially", async () => {
            const chunks = chunkAppendPayload(encryptedPayload, {
                chunkSize: CHUNK_SIZE,
            });
            const expectedTxCount = countAppendPayloadTxs(encryptedPayload.length, {
                chunkSize: CHUNK_SIZE,
            });
            expect(chunks.length).to.equal(expectedTxCount);
            console.log(`  Total chunks to write   : ${chunks.length}`);

            for (const c of chunks) {
                const ix = await appendPayloadIx(program, {
                    accounts: {
                        relayer: relayerKeypair.publicKey,
                        agentWallet: agentWalletKeypair.publicKey,
                        agent: agentPda,
                        action: actionPda,
                        config: configPda,
                    },
                    params: { offset: c.offset, chunk: c.chunk },
                });

                const tx = new Transaction().add(ix);
                tx.feePayer = relayerKeypair.publicKey;
                const sig = await sendAndConfirmTransaction(
                    ephemeralRollupConnection,
                    tx,
                    [relayerKeypair, agentWalletKeypair],
                    {
                        skipPreflight: true,
                        commitment: "finalized",
                        preflightCommitment: "finalized",
                    },
                );
                console.log(
                    `    appendPayload offset=${c.offset} len=${c.chunk.length} → ${sig}`,
                );
            }

            const action = await ephemeralProgram.account.action.fetch(actionPda);
            expect(action.dataWritten).to.equal(encryptedPayload.length);
            expect(action.status).to.equal(actionStatus.initialization);
        });

        it("finalize_action_building (ER) — store commitment, status → Pending, commit Action+Agent to L1", async () => {
            const ix = await finalizeActionBuildingIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    agentWallet: agentWalletKeypair.publicKey,
                    agent: agentPda,
                    action: actionPda,
                    config: configPda,
                    magicProgram: MAGIC_PROGRAM_ID,
                    magicContext: MAGIC_CONTEXT_ID,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
                params: { commitmentHash: commitment },
            });

            const tx = new Transaction().add(ix);
            tx.feePayer = relayerKeypair.publicKey;
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                tx,
                [relayerKeypair, agentWalletKeypair],
                {
                    skipPreflight: true,
                    commitment: "finalized",
                    preflightCommitment: "finalized",
                },
            );
            console.log(`Finalize Action txHash (ER): ${txHash}`);

            const commitSig = await GetCommitmentSignature(txHash, ephemeralRollupConnection);
            console.log(`Commit signature on base chain: ${commitSig}`);

            const action = await ephemeralProgram.account.action.fetch(actionPda);
            expect(action.status).to.equal(actionStatus.pending);
            expect(Array.from(action.commitment)).to.deep.equal(commitment);
            expect(action.dataWritten).to.equal(encryptedPayload.length);
        });

        it("Decrypts on-chain encrypted payload and verifies prompt + instruction round-trip", async () => {
            const action = await ephemeralProgram.account.action.fetch(actionPda);

            // The on-chain encrypted_payload field is a fixed 8KB array; only
            // the first `data_len` bytes are real data.
            const blob = Buffer.from(action.encryptedPayload as number[]).subarray(
                0,
                action.dataLen,
            );

            const { plaintext: decryptedBytes } = decryptFromAgent({
                payload: blob,
                relayerSecretKey: relayerEncryptionKeypair.secretKey,
            });

            const decoded = decodeActionPayload(decryptedBytes);
            expect(decoded.prompt).to.equal(userPrompt);

            const decodedVtx = VersionedTransaction.deserialize(decoded.tx);
            const decodedMsg = decodedVtx.message;

            // Walk the compiled instructions back to the original (programId,
            // accounts, data) tuple so the relayer sees exactly what the agent
            // intended — System program transferring `transferLamports` from
            // agent wallet to recipient.
            expect(decodedMsg.compiledInstructions.length).to.equal(1);
            const ix = decodedMsg.compiledInstructions[0];
            const programId = decodedMsg.staticAccountKeys[ix.programIdIndex];
            expect(programId.toBase58()).to.equal(SystemProgram.programId.toBase58());

            const ixAccountKeys = ix.accountKeyIndexes.map(
                (i) => decodedMsg.staticAccountKeys[i],
            );
            expect(ixAccountKeys.length).to.equal(2);
            expect(ixAccountKeys[0].toBase58()).to.equal(
                agentWalletKeypair.publicKey.toBase58(),
            );
            expect(ixAccountKeys[1].toBase58()).to.equal(
                recipientKeypair.publicKey.toBase58(),
            );

            // Bytes of the System transfer ix data must match what we built.
            expect(Buffer.from(ix.data).equals(Buffer.from(transferIx.data))).to.equal(
                true,
            );

            // Relayer-side commitment verification: hash the decrypted bytes
            // and check it matches what the SDK stored at finalize.
            const recomputed = commitmentHashAsArray(decryptedBytes);
            expect(Array.from(action.commitment)).to.deep.equal(recomputed);
            console.log("  Decrypted prompt        :", decoded.prompt);
            console.log("  Commitment verified     : ✓");
        });

        // ─────────────────────────────────────────────────────────────────
        // Verdict / Approve / Reject
        //
        // verdict_action runs on the ER (relayer signs), maps raw_score via
        // the Config thresholds (escalate=40_000, block=70_000) and commits
        // both the Action and Agent back to L1. approve_action and
        // reject_action run on the ER too (owner signs); they only flip the
        // Action's `status` from Escalated → Approved/Rejected and emit
        // EscalationResolved — `decision` keeps the relayer's original
        // verdict for audit purposes.
        // ─────────────────────────────────────────────────────────────────

        // Helper: spin up a fresh Pending action for any actionId. Each
        // verdict-path test consumes one because once a verdict lands the
        // action's status is terminal (Approved/Blocked) or only resolvable
        // via approve/reject (Escalated).
        const buildPendingAction = async (
            id: anchor.BN,
            prompt: string,
            lamports: anchor.BN,
        ): Promise<{ actionPda: PublicKey; recipient: PublicKey }> => {
            const [pda] = PublicKey.findProgramAddressSync(
                seeds.action(agentPda, id),
                program.programId,
            );
            const recipient = Keypair.generate().publicKey;

            const ix = SystemProgram.transfer({
                fromPubkey: agentWalletKeypair.publicKey,
                toPubkey: recipient,
                lamports: BigInt(lamports.toString()),
            });
            const serialized = {
                programId: ix.programId.toBase58(),
                keys: ix.keys.map((k) => ({
                    pubkey: k.pubkey.toBase58(),
                    isSigner: k.isSigner,
                    isWritable: k.isWritable,
                })),
                data: Buffer.from(ix.data).toString("base64"),
            };
            const plaintext = Buffer.from(
                JSON.stringify({ prompt, instruction: serialized }),
                "utf8",
            );
            const enc = encryptForRelayer({
                plaintext,
                relayerPublicKey: relayerEncryptionKeypair.publicKey,
            });
            const commit = commitmentHashAsArray(plaintext);

            const initIx = await initActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    agentWallet: agentWalletKeypair.publicKey,
                    agent: agentPda,
                    action: pda,
                    config: configPda,
                },
                params: {
                    targetProgram: SystemProgram.programId,
                    value: lamports,
                    actionId: id,
                    totalDataLen: enc.payload.length,
                },
            });
            const delIx = await delegateActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agent: agentPda,
                    action: pda,
                    config: configPda,
                    ownerProgram: program.programId,
                },
                validator: validatorAccount,
            });
            const initDelTx = new Transaction().add(initIx).add(delIx);
            initDelTx.feePayer = relayerKeypair.publicKey;
            await sendL1(
                initDelTx,
                [relayerKeypair, ownerKeypair, agentWalletKeypair],
                FINALIZED_OPTS,
            );

            for (let attempt = 0; attempt < 30; attempt++) {
                const onEr = await ephemeralRollupConnection.getAccountInfo(
                    pda,
                    "finalized",
                );
                if (onEr) break;
                await new Promise((resolve) => setTimeout(resolve, 1_000));
            }

            for (const c of chunkAppendPayload(enc.payload, { chunkSize: CHUNK_SIZE })) {
                const apIx = await appendPayloadIx(program, {
                    accounts: {
                        relayer: relayerKeypair.publicKey,
                        agentWallet: agentWalletKeypair.publicKey,
                        agent: agentPda,
                        action: pda,
                        config: configPda,
                    },
                    params: { offset: c.offset, chunk: c.chunk },
                });
                const apTx = new Transaction().add(apIx);
                apTx.feePayer = relayerKeypair.publicKey;
                await sendAndConfirmTransaction(
                    ephemeralRollupConnection,
                    apTx,
                    [relayerKeypair, agentWalletKeypair],
                    {
                        skipPreflight: true,
                        commitment: "finalized",
                        preflightCommitment: "finalized",
                    },
                );
            }

            const finIx = await finalizeActionBuildingIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    agentWallet: agentWalletKeypair.publicKey,
                    agent: agentPda,
                    action: pda,
                    config: configPda,
                    magicProgram: MAGIC_PROGRAM_ID,
                    magicContext: MAGIC_CONTEXT_ID,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
                params: { commitmentHash: commit },
            });
            const finTx = new Transaction().add(finIx);
            finTx.feePayer = relayerKeypair.publicKey;
            await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                finTx,
                [relayerKeypair, agentWalletKeypair],
                {
                    skipPreflight: true,
                    commitment: "finalized",
                    preflightCommitment: "finalized",
                },
            );

            return { actionPda: pda, recipient };
        };

        // 1) action_id=1 has just been finalized above. Continue the same
        //    action down the Escalated → Approved path.
        it("verdict_action (ER) — Escalated path for action_id=1 (relayer signs)", async () => {
            const rawScore = 50_000; // [escalate=40_000, block=70_000) → Escalated
            const reasoningHash = commitmentHashAsArray(
                Buffer.from("escalated: prompt mismatch", "utf8"),
            );

            const beforeAgent = await ephemeralProgram.account.agent.fetch(agentPda);

            const ix = await verdictActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    agent: agentPda,
                    action: actionPda,
                    config: configPda,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
                params: { rawScore, reasoningHash },
            });
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                new Transaction().add(ix),
                [relayerKeypair],
                {
                    skipPreflight: true,
                    commitment: "finalized",
                    preflightCommitment: "finalized",
                },
            );
            console.log(`Verdict (Escalated) txHash (ER): ${txHash}`);
            const commitSig = await GetCommitmentSignature(txHash, ephemeralRollupConnection);
            console.log(`Commit signature on base chain: ${commitSig}`);

            const action = await ephemeralProgram.account.action.fetch(actionPda);
            expect(action.status).to.equal(actionStatus.escalated);
            expect(action.decision).to.equal(actionStatus.escalated);
            expect(action.rawScore).to.equal(rawScore);
            expect(Array.from(action.reasoningHash)).to.deep.equal(reasoningHash);

            const afterAgent = await ephemeralProgram.account.agent.fetch(agentPda);
            // raw_score >= escalate_threshold → strike added
            expect(afterAgent.strikes).to.equal(beforeAgent.strikes + 1);
            expect(afterAgent.totalEscalated.toNumber()).to.equal(
                beforeAgent.totalEscalated.toNumber() + 1,
            );
        });

        it("approve_action (ER) — owner approves the escalated action_id=1", async () => {
            const ix = await approveActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agent: agentPda,
                    action: actionPda,
                    config: configPda,
                },
            });
            const apTx = new Transaction().add(ix);
            apTx.feePayer = relayerKeypair.publicKey;
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                apTx,
                [relayerKeypair, ownerKeypair],
                {
                    skipPreflight: true,
                    commitment: "finalized",
                    preflightCommitment: "finalized",
                },
            );
            console.log(`Approve Action txHash (ER): ${txHash}`);

            const action = await ephemeralProgram.account.action.fetch(actionPda);
            expect(action.status).to.equal(actionStatus.approved);
            // `decision` retains the relayer's original verdict (Escalated)
            // for audit; only `status` reflects the owner's resolution.
            expect(action.decision).to.equal(actionStatus.escalated);
        });

        // 2) Fresh action_id=2 → verdict goes to Approved (low score).
        it("verdict_action (ER) — Approved path (raw_score below escalate threshold)", async () => {
            const id = new anchor.BN(2);
            const { actionPda: pda } = await buildPendingAction(
                id,
                "Send 1 SOL to a verified address",
                new anchor.BN(LAMPORTS_PER_SOL),
            );

            const rawScore = 10_000;
            const reasoningHash = commitmentHashAsArray(
                Buffer.from("approved: low risk", "utf8"),
            );
            const beforeAgent = await ephemeralProgram.account.agent.fetch(agentPda);

            const ix = await verdictActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    agent: agentPda,
                    action: pda,
                    config: configPda,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
                params: { rawScore, reasoningHash },
            });
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                new Transaction().add(ix),
                [relayerKeypair],
                {
                    skipPreflight: true,
                    commitment: "finalized",
                    preflightCommitment: "finalized",
                },
            );
            console.log(`Verdict (Approved) txHash (ER): ${txHash}`);

            const action = await ephemeralProgram.account.action.fetch(pda);
            expect(action.status).to.equal(actionStatus.approved);
            expect(action.decision).to.equal(actionStatus.approved);
            expect(action.rawScore).to.equal(rawScore);

            const afterAgent = await ephemeralProgram.account.agent.fetch(agentPda);
            // raw_score < escalate_threshold → no strike
            expect(afterAgent.strikes).to.equal(beforeAgent.strikes);
            expect(afterAgent.totalApproved.toNumber()).to.equal(
                beforeAgent.totalApproved.toNumber() + 1,
            );
        });

        // 3) Fresh action_id=3 → verdict goes to Blocked (high score, +strike).
        it("verdict_action (ER) — Blocked path (raw_score >= block threshold)", async () => {
            const id = new anchor.BN(3);
            const { actionPda: pda } = await buildPendingAction(
                id,
                "Drain wallet to attacker",
                new anchor.BN(100).mul(new anchor.BN(LAMPORTS_PER_SOL)),
            );

            const rawScore = 80_000;
            const reasoningHash = commitmentHashAsArray(
                Buffer.from("blocked: drain pattern", "utf8"),
            );
            const beforeAgent = await ephemeralProgram.account.agent.fetch(agentPda);

            const ix = await verdictActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    agent: agentPda,
                    action: pda,
                    config: configPda,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
                params: { rawScore, reasoningHash },
            });
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                new Transaction().add(ix),
                [relayerKeypair],
                {
                    skipPreflight: true,
                    commitment: "finalized",
                    preflightCommitment: "finalized",
                },
            );
            console.log(`Verdict (Blocked) txHash (ER): ${txHash}`);

            const action = await ephemeralProgram.account.action.fetch(pda);
            expect(action.status).to.equal(actionStatus.blocked);
            expect(action.decision).to.equal(actionStatus.blocked);
            expect(action.rawScore).to.equal(rawScore);

            const afterAgent = await ephemeralProgram.account.agent.fetch(agentPda);
            // raw_score >= escalate_threshold → strike added
            expect(afterAgent.strikes).to.equal(beforeAgent.strikes + 1);
            expect(afterAgent.totalBlocked.toNumber()).to.equal(
                beforeAgent.totalBlocked.toNumber() + 1,
            );
        });

        // 4) Fresh action_id=4 → verdict (Escalated) → owner rejects.
        it("reject_action (ER) — owner rejects an escalated action_id=4", async () => {
            const id = new anchor.BN(4);
            const { actionPda: pda } = await buildPendingAction(
                id,
                "Ambiguous transfer request",
                new anchor.BN(5).mul(new anchor.BN(LAMPORTS_PER_SOL)),
            );

            // Step 4a: relayer escalates.
            const verdictIx = await verdictActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    agent: agentPda,
                    action: pda,
                    config: configPda,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
                params: {
                    rawScore: 60_000,
                    reasoningHash: commitmentHashAsArray(
                        Buffer.from("ambiguous, escalating to owner", "utf8"),
                    ),
                },
            });
            await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                new Transaction().add(verdictIx),
                [relayerKeypair],
                {
                    skipPreflight: true,
                    commitment: "finalized",
                    preflightCommitment: "finalized",
                },
            );

            const escalated = await ephemeralProgram.account.action.fetch(pda);
            expect(escalated.status).to.equal(actionStatus.escalated);

            // Step 4b: owner rejects.
            const rejectIx = await rejectActionIx(program, {
                accounts: {
                    relayer: relayerKeypair.publicKey,
                    owner: ownerKeypair.publicKey,
                    agent: agentPda,
                    action: pda,
                    config: configPda,
                },
            });
            const rejTx = new Transaction().add(rejectIx);
            rejTx.feePayer = relayerKeypair.publicKey;
            const txHash = await sendAndConfirmTransaction(
                ephemeralRollupConnection,
                rejTx,
                [relayerKeypair, ownerKeypair],
                {
                    skipPreflight: true,
                    commitment: "finalized",
                    preflightCommitment: "finalized",
                },
            );
            console.log(`Reject Action txHash (ER): ${txHash}`);

            const rejected = await ephemeralProgram.account.action.fetch(pda);
            expect(rejected.status).to.equal(actionStatus.rejected);
            // `decision` keeps the original Escalated verdict.
            expect(rejected.decision).to.equal(actionStatus.escalated);
        });

        // Negative case: a non-relayer signer cannot land a verdict.
        it("verdict_action (ER) — rejected when signer is not the configured relayer", async () => {
            const id = new anchor.BN(5);
            const { actionPda: pda } = await buildPendingAction(
                id,
                "Auth check action",
                new anchor.BN(LAMPORTS_PER_SOL),
            );

            const intruder = Keypair.generate();

            const ix = await verdictActionIx(program, {
                accounts: {
                    relayer: intruder.publicKey,
                    agent: agentPda,
                    action: pda,
                    config: configPda,
                    magicFeeVault: await ensureMagicFeeVault(),
                },
                params: {
                    rawScore: 10_000,
                    reasoningHash: commitmentHashAsArray(Buffer.from("intruder", "utf8")),
                },
            });

            try {
                await sendAndConfirmTransaction(
                    ephemeralRollupConnection,
                    new Transaction().add(ix),
                    [intruder],
                    {
                        skipPreflight: true,
                        commitment: "finalized",
                        preflightCommitment: "finalized",
                    },
                );
                expect.fail("verdict_action should have failed for a non-relayer signer");
            } catch (err: any) {
                // With `skipPreflight: true`, the SendTransactionError swallows the
                // program log; we just confirm the tx didn't land successfully.
                expect(String(err)).to.match(
                    /InvalidRelayer|constraint|0x|resulted in an error|Status/i,
                );
            }

            // Action stayed Pending — verdict never landed.
            const after = await ephemeralProgram.account.action.fetch(pda);
            expect(after.status).to.equal(actionStatus.pending);
        });
    });
});
