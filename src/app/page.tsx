'use client';

import { useState, useCallback } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWriteContract,
  useReadContract,
} from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import type { Hex } from 'viem';
import { CCTP, addressToBytes32, USDC_FAUCET } from '@/lib/cctp';
import { usdcAbi, tokenMessengerV2Abi, messageTransmitterV2Abi } from '@/lib/abis';

type ChainKey = 'sepolia' | 'avalancheFuji';
type Step = 'idle' | 'approving' | 'burning' | 'attesting' | 'receiving' | 'done';

interface TransferState {
  srcChain: ChainKey;
  dstChain: ChainKey;
  amount: string;
  approveTxHash: Hex | null;
  burnTxHash: Hex | null;
  messageBytes: Hex | null;
  messageHash: Hex | null;
  attestation: Hex | null;
  receiveTxHash: Hex | null;
}

const CHAIN_ID_MAP: Record<number, ChainKey> = {
  [CCTP.sepolia.chain.id]: 'sepolia',
  [CCTP.avalancheFuji.chain.id]: 'avalancheFuji',
};

function truncateHex(hex: string, chars = 8): string {
  if (!hex) return '';
  return `${hex.slice(0, chars + 2)}…${hex.slice(-chars)}`;
}

function TxLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
    >
      {label}
      <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

function Pill({ children, color = 'slate' }: { children: React.ReactNode; color?: 'slate' | 'indigo' | 'emerald' | 'amber' }) {
  const colors = {
    slate:   'bg-slate-800 text-slate-300',
    indigo:  'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    amber:   'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function StatusBadge({ ready }: { ready: boolean | null }) {
  if (ready === null) return <Pill color="slate">not checked</Pill>;
  return ready
    ? <Pill color="emerald">✔ attestation ready</Pill>
    : <Pill color="amber">⏳ pending confirmation</Pill>;
}

function StepNumber({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  if (done) {
    return (
      <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-sm">
        ✓
      </span>
    );
  }
  return (
    <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all ${
      active
        ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(99,102,241,0.4)]'
        : 'bg-slate-800 text-slate-500 border border-slate-700'
    }`}>
      {n}
    </span>
  );
}

function Card({
  step,
  title,
  active,
  done = false,
  children,
}: {
  step: number;
  title: string;
  active: boolean;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-6 transition-all duration-200 ${
      active
        ? 'border-indigo-500/40 bg-slate-900/80 shadow-[0_0_0_1px_rgba(99,102,241,0.1),0_4px_24px_rgba(0,0,0,0.4)]'
        : done
        ? 'border-emerald-500/20 bg-slate-900/40'
        : 'border-slate-800 bg-slate-900/30 opacity-50'
    }`}>
      <div className="flex items-center gap-3 mb-5">
        <StepNumber n={step} active={active} done={done} />
        <h2 className={`font-semibold text-sm tracking-wide ${active ? 'text-white' : done ? 'text-slate-400' : 'text-slate-500'}`}>
          {title}
        </h2>
      </div>
      <div className={active || done ? '' : 'pointer-events-none select-none'}>
        {children}
      </div>
    </div>
  );
}

function PrimaryButton({ onClick, disabled, children }: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all
        bg-indigo-600 hover:bg-indigo-500 text-white
        disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed
        shadow-[0_2px_12px_rgba(99,102,241,0.3)] disabled:shadow-none
        active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function GhostButton({ onClick, disabled, children }: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all
        bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700
        disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function SuccessButton({ onClick, disabled, children }: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all
        bg-emerald-600 hover:bg-emerald-500 text-white
        disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed
        shadow-[0_2px_12px_rgba(16,185,129,0.25)] disabled:shadow-none
        active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{children}</span>;
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<Step>('idle');
  const [state, setState] = useState<TransferState>({
    srcChain: 'sepolia',
    dstChain: 'avalancheFuji',
    amount: '1',
    approveTxHash: null,
    burnTxHash: null,
    messageBytes: null,
    messageHash: null,
    attestation: null,
    receiveTxHash: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [attestationStatus, setAttestationStatus] = useState<boolean | null>(null);
  const [decodedMessage, setDecodedMessage] = useState<Record<string, unknown> | null>(null);

  const src = CCTP[state.srcChain];
  const dst = CCTP[state.dstChain];
  const connectedKey = CHAIN_ID_MAP[chainId];

  const { data: usdcBalance } = useReadContract({
    address: connectedKey ? CCTP[connectedKey].usdc : undefined,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address && !!connectedKey, refetchInterval: 10_000 },
  });

  const amountBigint = (() => {
    try { return parseUnits(state.amount || '0', 6); }
    catch { return 0n; }
  })();

  const handleApproveAndBurn = useCallback(async () => {
    if (!address) return;
    setError(null);

    if (connectedKey !== state.srcChain) {
      try { await switchChain({ chainId: src.chain.id }); }
      catch { setError('Please switch your wallet to ' + src.name); return; }
    }

    try {
      setStep('approving');
      const approveTx = await writeContractAsync({
        address: src.usdc, abi: usdcAbi, functionName: 'approve',
        args: [src.tokenMessenger, amountBigint], chainId: src.chain.id,
      });
      setState(s => ({ ...s, approveTxHash: approveTx }));

      setStep('burning');
      const burnTx = await writeContractAsync({
        address: src.tokenMessenger, abi: tokenMessengerV2Abi, functionName: 'depositForBurn',
        args: [
          amountBigint, dst.domainId, addressToBytes32(address),
          src.usdc, `0x${'00'.repeat(32)}` as Hex,
          0n, 2000,
        ],
        chainId: src.chain.id,
      });
      setState(s => ({ ...s, burnTxHash: burnTx }));

      const burnInfoRes = await fetch(`/api/burn-info?txHash=${burnTx}&srcChain=${state.srcChain}`);
      if (burnInfoRes.ok) {
        const { messageBytes, messageHash } = await burnInfoRes.json();
        setState(s => ({ ...s, messageBytes, messageHash }));
      }

      setStep('attesting');
    } catch (err) {
      setError(String(err));
      setStep('idle');
    }
  }, [address, connectedKey, state.srcChain, amountBigint, src, dst, switchChain, writeContractAsync]);

  const checkAttestation = useCallback(async () => {
    if (!state.burnTxHash) return;
    setError(null);
    try {
      const res = await fetch('/api/attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: state.burnTxHash, srcDomain: src.domainId }),
      });
      const data = await res.json();
      setAttestationStatus(data.ready ?? false);
      if (data.ready) {
        setState(s => ({ ...s, attestation: data.attestation, messageBytes: data.message ?? s.messageBytes }));
      }
      const msgBytes = data.message ?? state.messageBytes;
      if (msgBytes) {
        const decRes = await fetch('/api/decode-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageBytes: msgBytes }),
        });
        if (decRes.ok) {
          const { decoded } = await decRes.json();
          setDecodedMessage(decoded);
        }
      }
    } catch (err) { setError(String(err)); }
  }, [state.burnTxHash, state.messageBytes, src.domainId]);

  const handleReceive = useCallback(async () => {
    if (!state.messageBytes || !state.attestation) return;
    setError(null);

    if (connectedKey !== state.dstChain) {
      try { await switchChain({ chainId: dst.chain.id }); }
      catch { setError('Please switch your wallet to ' + dst.name); return; }
    }

    try {
      setStep('receiving');
      const receiveTx = await writeContractAsync({
        address: dst.messageTransmitter, abi: messageTransmitterV2Abi, functionName: 'receiveMessage',
        args: [state.messageBytes, state.attestation], chainId: dst.chain.id,
      });
      setState(s => ({ ...s, receiveTxHash: receiveTx }));
      setStep('done');
    } catch (err) {
      setError(String(err));
      setStep('attesting');
    }
  }, [state.messageBytes, state.attestation, state.dstChain, connectedKey, dst, switchChain, writeContractAsync]);

  const reset = () => {
    setStep('idle');
    setState(s => ({ ...s, approveTxHash: null, burnTxHash: null, messageBytes: null, messageHash: null, attestation: null, receiveTxHash: null }));
    setAttestationStatus(null);
    setDecodedMessage(null);
    setError(null);
  };

  const activeStep =
    !isConnected ? 0 :
    step === 'idle' ? 1 :
    step === 'approving' || step === 'burning' ? 2 :
    step === 'attesting' ? 3 :
    step === 'receiving' || step === 'done' ? 4 : 1;

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.12) 0%, transparent 60%), #080b12' }}>
      <main className="max-w-xl mx-auto px-4 py-12 space-y-3">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold tracking-widest text-indigo-400 uppercase">Circle CCTP V2</span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Cross-Chain Transfer</h1>
            <p className="text-sm text-slate-500 mt-1">Sepolia → Avalanche Fuji · Fast transfer</p>
          </div>
          <ConnectButton showBalance={false} />
        </div>

        {error && (
          <div className="flex gap-3 items-start rounded-xl bg-red-500/10 border border-red-500/25 px-4 py-3">
            <span className="text-red-400 mt-0.5 shrink-0">⚠</span>
            <p className="text-sm text-red-300 leading-relaxed">{error}</p>
          </div>
        )}

        {/* Step 1 — Connect */}
        <Card step={1} title="Connect Wallet" active={activeStep >= 1} done={isConnected}>
          {!isConnected ? (
            <p className="text-sm text-slate-500">Use the button in the top right to connect MetaMask.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-slate-800/60 px-4 py-3 border border-slate-700/50">
                <div>
                  <Label>Address</Label>
                  <p className="font-mono text-sm text-slate-200 mt-0.5">{truncateHex(address ?? '', 12)}</p>
                </div>
                {connectedKey && usdcBalance !== undefined && (
                  <div className="text-right">
                    <Label>USDC balance</Label>
                    <p className="text-sm font-semibold text-white mt-0.5">{formatUnits(usdcBalance, 6)}</p>
                  </div>
                )}
              </div>
              {connectedKey && (
                <div className="flex items-center gap-2">
                  <Pill color="indigo">{CCTP[connectedKey].name}</Pill>
                  <span className="text-slate-600">·</span>
                  <a href={USDC_FAUCET} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:text-indigo-400 transition-colors">
                    USDC faucet ↗
                  </a>
                  <span className="text-slate-600">·</span>
                  <a href={src.faucet} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:text-indigo-400 transition-colors">
                    {src.nativeSymbol} faucet ↗
                  </a>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Step 2 — Burn */}
        <Card
          step={2}
          title={`Approve & Burn on ${src.name}`}
          active={isConnected && (step === 'idle' || step === 'approving' || step === 'burning')}
          done={!!state.burnTxHash && step !== 'approving' && step !== 'burning'}
        >
          <div className="space-y-4">
            <div>
              <Label>Amount</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="number"
                  min="0.000001"
                  step="0.1"
                  value={state.amount}
                  onChange={e => setState(s => ({ ...s, amount: e.target.value }))}
                  disabled={step !== 'idle'}
                  className="w-36 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white
                    focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30
                    disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  placeholder="1.0"
                />
                <span className="text-sm font-semibold text-slate-300 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5">USDC</span>
              </div>
            </div>

            <div className="flex gap-3 text-xs text-slate-500">
              <span>Fee: <span className="text-slate-400">none</span></span>
              <span className="text-slate-700">|</span>
              <span>Finality: <span className="text-slate-400">Standard (~15–20 min)</span></span>
            </div>

            {state.approveTxHash && (
              <div className="flex items-center gap-2">
                <Pill color="emerald">✓ Approved</Pill>
                <TxLink href={src.explorerTx(state.approveTxHash)} label={truncateHex(state.approveTxHash)} />
              </div>
            )}
            {state.burnTxHash && (
              <div className="flex items-center gap-2">
                <Pill color="emerald">✓ Burned</Pill>
                <TxLink href={src.explorerTx(state.burnTxHash)} label={truncateHex(state.burnTxHash)} />
              </div>
            )}

            {(step === 'idle' || step === 'approving' || step === 'burning') && isConnected && (
              <PrimaryButton onClick={handleApproveAndBurn} disabled={step !== 'idle' || !amountBigint}>
                {step === 'approving' ? '1/2 — Approving…' : step === 'burning' ? '2/2 — Burning…' : 'Approve & Burn'}
              </PrimaryButton>
            )}
          </div>
        </Card>

        {/* Step 3 — Attestation */}
        <Card step={3} title="Circle Attestation" active={step === 'attesting'} done={attestationStatus === true && step !== 'attesting'}>
          <div className="space-y-4">
            <p className="text-sm text-slate-400 leading-relaxed">
              Circle signs the burn message once it&apos;s confirmed on-chain.{' '}
              <span className="text-slate-500">Kwala calls</span>{' '}
              <code className="text-xs bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded-lg text-indigo-300 font-mono">
                POST /api/attestation
              </code>{' '}
              <span className="text-slate-500">at its own interval.</span>
            </p>

            {state.messageHash && (
              <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 px-4 py-3">
                <Label>Message hash</Label>
                <p className="font-mono text-xs text-slate-300 mt-1">{truncateHex(state.messageHash, 16)}</p>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <GhostButton onClick={checkAttestation} disabled={!state.burnTxHash}>
                Check now (simulate Kwala tick)
              </GhostButton>
              <StatusBadge ready={attestationStatus} />
            </div>

            {decodedMessage && (
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer text-xs text-slate-500 hover:text-slate-300 transition-colors select-none">
                  <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  Decoded message
                </summary>
                <pre className="mt-2 text-xs bg-slate-800/80 border border-slate-700/50 rounded-xl p-4 overflow-auto max-h-56 text-slate-300 leading-relaxed">
                  {JSON.stringify(decodedMessage, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </Card>

        {/* Step 4 — Receive */}
        <Card
          step={4}
          title={`Receive on ${dst.name}`}
          active={(step === 'attesting' && attestationStatus === true) || step === 'receiving' || step === 'done'}
          done={step === 'done'}
        >
          <div className="space-y-4">
            {step === 'done' && state.receiveTxHash ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3">
                  <span className="text-2xl">✓</span>
                  <div>
                    <p className="text-sm font-semibold text-emerald-400">Transfer complete</p>
                    <p className="text-xs text-emerald-500/80 mt-0.5">USDC minted on {dst.name}</p>
                  </div>
                </div>
                <TxLink href={dst.explorerTx(state.receiveTxHash)} label={`View on ${dst.name === 'Avalanche Fuji' ? 'Snowtrace' : 'Explorer'}: ${truncateHex(state.receiveTxHash)}`} />
                <GhostButton onClick={reset}>Start new transfer</GhostButton>
              </div>
            ) : attestationStatus ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">
                  Attestation ready — switch to <span className="text-white font-medium">{dst.name}</span> and submit the receive transaction.
                </p>
                <SuccessButton onClick={handleReceive} disabled={step === 'receiving'}>
                  {step === 'receiving' ? 'Receiving…' : `Receive on ${dst.name}`}
                </SuccessButton>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Waiting for attestation…</p>
            )}
          </div>
        </Card>

        {/* API reference */}
        <details className="group rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
          <summary className="flex items-center justify-between cursor-pointer select-none">
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">API Routes</span>
            <svg className="w-4 h-4 text-slate-600 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="mt-4 space-y-4">
            {[
              {
                method: 'POST', path: '/api/attestation',
                body: '{ txHash, srcDomain }',
                desc: 'Called by Kwala. One fetch to Circle\'s sandbox; returns { ready, message, attestation, raw }.',
              },
              {
                method: 'GET', path: '/api/burn-info',
                body: '?txHash=&srcChain=',
                desc: 'Fetches tx receipt, parses MessageSent log; returns { messageBytes, messageHash }.',
              },
              {
                method: 'POST', path: '/api/decode-message',
                body: '{ messageBytes }',
                desc: 'Decodes raw CCTP V2 message bytes locally; returns { header, body }.',
              },
            ].map(({ method, path, body, desc }) => (
              <div key={path} className="rounded-xl bg-slate-800/50 border border-slate-700/40 px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${method === 'POST' ? 'bg-violet-500/20 text-violet-300' : 'bg-sky-500/20 text-sky-300'}`}>
                    {method}
                  </span>
                  <code className="text-xs text-slate-200 font-mono">{path}</code>
                  <code className="text-xs text-slate-500 font-mono">{body}</code>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </details>

      </main>
    </div>
  );
}
