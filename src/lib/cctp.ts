import { sepolia, avalancheFuji } from 'wagmi/chains';

export const CHAINS = {
  sepolia,
  avalancheFuji,
} as const;

export const CCTP = {
  sepolia: {
    chain: sepolia,
    domainId: 0,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as `0x${string}`,
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as `0x${string}`,
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as `0x${string}`,
    explorerTx: (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`,
    name: 'Ethereum Sepolia',
    nativeSymbol: 'ETH',
    faucet: 'https://sepolia-faucet.pk910.de/',
  },
  avalancheFuji: {
    chain: avalancheFuji,
    domainId: 1,
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65' as `0x${string}`,
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as `0x${string}`,
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as `0x${string}`,
    explorerTx: (hash: string) => `https://testnet.snowtrace.io/tx/${hash}`,
    name: 'Avalanche Fuji',
    nativeSymbol: 'AVAX',
    faucet: 'https://faucet.avax.network/',
  },
} as const;

export type ChainKey = keyof typeof CCTP;

export const ATTESTATION_BASE = 'https://iris-api-sandbox.circle.com';

// Set NEXT_PUBLIC_REGISTRY_ADDRESS in .env.local after deploying CCTPRegistry.sol
export const REGISTRY_ADDRESS = (
  process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? ''
) as `0x${string}`;

export const USDC_FAUCET = 'https://faucet.circle.com/';

// maxFee = 1% of amount, minimum 1000 (0.001 USDC) to satisfy the testnet minFee threshold
export function calcMaxFee(amount: bigint): bigint {
  const fee = amount / 100n;
  return fee < 1000n ? 1000n : fee;
}

export function addressToBytes32(addr: `0x${string}`): `0x${string}` {
  return `0x${addr.slice(2).padStart(64, '0')}` as `0x${string}`;
}
