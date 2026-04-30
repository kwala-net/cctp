# CCTP V2 Demo

A Next.js app for cross-chain USDC transfers using [Circle's Cross-Chain Transfer Protocol V2](https://developers.circle.com/cctp). Transfers originate on Ethereum Sepolia and land on either Avalanche Fuji or Arbitrum Sepolia. The receive step is handled by a bot (Kwala) — the user never has to sign on the destination chain.

## Contract addresses (testnets)

Circle deploys CCTP V2 at the same addresses across all supported testnets.

| Contract | Address | Chains |
|---|---|---|
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | Sepolia, Fuji, Arb Sepolia |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | Sepolia, Fuji, Arb Sepolia |
| USDC (Sepolia) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | Ethereum Sepolia |
| USDC (Fuji) | `0x5425890298aed601595a70AB815c96711a31Bc65` | Avalanche Fuji |
| USDC (Arb Sepolia) | `0xf3c3351D6Bd0098EeB33ca8f830faf2a141Ea2e1` | Arbitrum Sepolia |

`receiveMessage` (the claim call) lives on **MessageTransmitterV2** and is called on the **destination chain**.

## Transfer flow

```
User (source chain: Ethereum Sepolia)
  │
  ├─ 1. approve(TokenMessengerV2, amount)          [user signs]
  ├─ 2. depositForBurn(amount, dstDomain, ...)     [user signs — USDC burned, MessageSent emitted]
  └─ 3. CCTPRegistry.register(burnTxHash, ...)     [user signs — records transfer on-chain]

Kwala (calls POST /api/attestation with no body)
  │
  ├─ 4. reads CCTPRegistry.getPendingRequests()    [on-chain read, Sepolia]
  ├─ 5. polls Circle iris-api-sandbox for each tx
  │
  │  when attestation is ready:
  ├─ 6. CCTPRegistry.markAttested(burnTxHash, messageBytes, attestation)
  │       → emits RequestCompleted(burnTxHash, sender, messageBytes, attestation)
  │                                                [relayer wallet signs, Sepolia]
  │
  └─ 7. MessageTransmitterV2.receiveMessage(messageBytes, attestation)
                                                   [relayer wallet signs, DESTINATION chain]
                                                   → USDC minted to user's wallet
```

Steps 1–3 are signed by the user, all on Ethereum Sepolia. Steps 6–7 are signed by the Kwala relayer wallet — the user never has to touch the destination chain.

## CCTPRegistry

A permissionless on-chain registry deployed on Ethereum Sepolia. It tracks transfers so Kwala knows what to poll for without the user providing any context.

| Function | Called by | When |
|---|---|---|
| `register(burnTxHash, srcDomain, dstDomain, amount)` | User (frontend) | Right after `depositForBurn` |
| `markAttested(burnTxHash, messageBytes, attestation)` | Relayer (API route) | When Circle attestation is ready — emits `RequestCompleted` |
| `getPendingRequests()` | API route | Each Kwala tick — returns burns not yet attested |

## API routes

| Route | Caller | What it does |
|---|---|---|
| `POST /api/attestation` (no body) | Kwala | Reads pending registry requests, polls Circle, calls `markAttested` for ready ones |
| `POST /api/attestation` `{ txHash, srcDomain }` | Frontend | Checks a single tx directly against Circle (bypasses registry) |
| `GET /api/burn-info?txHash=&srcChain=` | Frontend | Parses `MessageSent` from the burn tx receipt, returns `messageBytes` |
| `POST /api/decode-message` `{ messageBytes }` | Frontend | Decodes raw CCTP V2 message bytes locally |

## Claim script (manual / alternative bot)

`scripts/claim.js` is a standalone ethers.js script that calls `receiveMessage` directly. Any wallet with destination-chain gas can run it — the USDC always mints to the address encoded in the original burn message.

```bash
npm install ethers dotenv

MESSAGE_BYTES=0x... \
ATTESTATION=0x... \
PRIVATE_KEY=0x... \
DST_CHAIN=arbitrumSepolia \   # or: avalancheFuji
node scripts/claim.js
```

## Setup

```bash
npm install
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
# optional: NEXT_PUBLIC_REGISTRY_ADDRESS (deploy contracts/ first)
# optional: REGISTRY_RELAYER_PRIVATE_KEY  (Sepolia ETH needed for gas)
npm run dev
```

### Deploy the registry contract

```bash
cd contracts
forge script script/DeployCCTPRegistry.s.sol \
  --rpc-url https://rpc.sepolia.org \
  --private-key YOUR_PRIVATE_KEY \
  --broadcast
# copy the deployed address into NEXT_PUBLIC_REGISTRY_ADDRESS in .env.local
```

## CCTP domain IDs

| Chain | Domain |
|---|---|
| Ethereum Sepolia | 0 |
| Avalanche Fuji | 1 |
| Arbitrum Sepolia | 3 |
