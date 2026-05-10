#!/bin/bash

set -e

DEVNET_RPC="https://api.devnet.solana.com"
SO_FILE="target/deploy/contract.so"
KEYPAIR="accounts/devnet/operator.json"

echo ""
echo "========================================="
echo "   Bento Contract — Devnet Deployment"
echo "========================================="
echo ""

# Step 1: Build
echo "[1/3] Building contract (features: dev)..."
anchor build -- --features dev
echo "      Build complete."
echo ""

# Step 2: Check and set Solana config
echo "[2/3] Checking Solana config..."
solana config get

CURRENT_RPC=$(solana config get | grep "RPC URL" | awk '{print $3}')

if [ "$CURRENT_RPC" != "$DEVNET_RPC" ]; then
  echo ""
  echo "      RPC is not devnet (got: $CURRENT_RPC)"
  echo "      Switching to devnet..."
  solana config set -u "$DEVNET_RPC"
  echo "      RPC updated to $DEVNET_RPC"
else
  echo "      RPC is already set to devnet. OK."
fi
echo ""

# Step 3: Pre-flight balance check
echo "[3/4] Checking deployer balance vs required rent..."

SO_SIZE=$(wc -c < "$SO_FILE")
echo "      Program size : $SO_SIZE bytes"

# solana rent returns a line like "Rent-exempt minimum: X.XXXXXXXXX SOL"
REQUIRED_SOL=$(solana rent "$SO_SIZE" | grep -oE '[0-9]+\.[0-9]+' | head -1)
echo "      Required rent: $REQUIRED_SOL SOL (buffer account rent exemption)"

DEPLOYER_PUBKEY=$(solana-keygen pubkey "$KEYPAIR")
CURRENT_BALANCE=$(solana balance "$DEPLOYER_PUBKEY" --url "$DEVNET_RPC" | grep -oE '[0-9]+\.[0-9]+' | head -1)
echo "      Deployer     : $DEPLOYER_PUBKEY"
echo "      Balance      : $CURRENT_BALANCE SOL"

# Compare using awk (bash can't do float math natively)
SUFFICIENT=$(awk -v bal="$CURRENT_BALANCE" -v req="$REQUIRED_SOL" 'BEGIN { print (bal >= req) ? "yes" : "no" }')
if [ "$SUFFICIENT" = "no" ]; then
  echo ""
  echo "  [!] Insufficient balance: need at least $REQUIRED_SOL SOL, have $CURRENT_BALANCE SOL."
  echo "      Request an airdrop:"
  echo "        solana airdrop 2 $DEPLOYER_PUBKEY --url $DEVNET_RPC"
  echo ""
  exit 1
fi

echo "      Balance check passed."
echo ""

# Step 4: Deploy — chunk upload is handled internally by solana program deploy.
# --max-sign-attempts retries individual chunk transactions on transient RPC errors.
echo "[4/4] Deploying $SO_FILE to devnet..."
echo "      (large programs upload in chunks — this may take a few minutes)"
echo ""
solana program deploy "$SO_FILE" \
  -k "$KEYPAIR" \
  --use-rpc \
  --max-sign-attempts 50

echo ""
echo "========================================="
echo "   Deployment complete!"
echo "========================================="
echo ""
