#!/usr/bin/env node
/**
 * CCTP V2 — Claim script (bot-friendly, any wallet can call)
 *
 * Usage:
 *   node scripts/claim.js
 *
 * Required env vars:
 *   PRIVATE_KEY      — hex private key of the relayer/bot wallet (no 0x prefix needed)
 *   MESSAGE_BYTES    — 0x-prefixed message bytes from the burn tx MessageSent log
 *   ATTESTATION      — 0x-prefixed attestation from Circle's API
 *
 * Optional env vars:
 *   DST_CHAIN        — "arbitrumSepolia" (default) or "avalancheFuji"
 *   RPC_URL          — override the default public RPC
 *
 * Install deps once:
 *   npm install ethers dotenv   (or: npm install --save-dev ethers dotenv)
 *
 * The bot wallet only needs enough ETH for gas — the USDC is minted to whatever
 * address is encoded in the original burn message (mintRecipient), not to this wallet.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { ethers } = require('ethers');

const CHAINS = {
  arbitrumSepolia: {
    name: 'Arbitrum Sepolia',
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: hash => `https://sepolia.arbiscan.io/tx/${hash}`,
  },
  avalancheFuji: {
    name: 'Avalanche Fuji',
    rpc: 'https://api.avax-test.network/ext/bc/C/rpc',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: hash => `https://testnet.snowtrace.io/tx/${hash}`,
  },
};

const MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool)',
  'function usedNonces(bytes32 sourceAndNonce) external view returns (uint256)',
];

async function main() {
  const privateKey = process.env.PRIVATE_KEY?.replace(/^0x/, '');
  const messageBytes = process.env.MESSAGE_BYTES;
  const attestation = process.env.ATTESTATION;
  const dstChainKey = process.env.DST_CHAIN ?? 'arbitrumSepolia';

  if (!privateKey) throw new Error('PRIVATE_KEY env var is required');
  if (!messageBytes) throw new Error('MESSAGE_BYTES env var is required');
  if (!attestation) throw new Error('ATTESTATION env var is required');

  const chain = CHAINS[dstChainKey];
  if (!chain) throw new Error(`Unknown DST_CHAIN "${dstChainKey}". Use: ${Object.keys(CHAINS).join(', ')}`);

  const rpcUrl = process.env.RPC_URL ?? chain.rpc;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(`0x${privateKey}`, provider);

  const transmitter = new ethers.Contract(chain.messageTransmitter, MESSAGE_TRANSMITTER_ABI, wallet);

  console.log(`Chain:      ${chain.name}`);
  console.log(`Relayer:    ${wallet.address}`);
  console.log(`Message:    ${messageBytes.slice(0, 20)}…`);
  console.log(`Transmitter: ${chain.messageTransmitter}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`ETH balance: ${ethers.formatEther(balance)} ETH`);

  console.log('\nSubmitting receiveMessage…');
  const tx = await transmitter.receiveMessage(messageBytes, attestation);
  console.log(`Tx hash:    ${tx.hash}`);
  console.log(`Explorer:   ${chain.explorer(tx.hash)}`);

  const receipt = await tx.wait();
  if (receipt.status === 1) {
    console.log('\nSuccess — USDC minted on', chain.name);
  } else {
    console.error('\nTransaction reverted');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message ?? err);
  process.exit(1);
});
