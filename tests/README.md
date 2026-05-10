Run test:
- Run local chain: mb-test-validator --reset    
- Run ER: ephemeral-validator --remotes "http://localhost:8899" --remotes "ws://localhost:8900" -l "7799" --lifecycle ephemeral
- Run test: EPHEMERAL_PROVIDER_ENDPOINT="http://localhost:7799" \
EPHEMERAL_WS_ENDPOINT="ws://localhost:7800" \
anchor test \
  --provider.cluster localnet \
  --skip-local-validator