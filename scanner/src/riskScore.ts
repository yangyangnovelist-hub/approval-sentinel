import { readFileSync } from 'node:fs';
import { maxUint256 } from 'viem';
import type { Address } from 'viem';

interface KnownProtocolsFile {
  comment: string;
  protocols: Record<string, string>;
}

const knownProtocolsFile = JSON.parse(
  readFileSync(new URL('../data/known-protocols.json', import.meta.url), 'utf8'),
) as KnownProtocolsFile;

/** Lowercase mainnet spender address -> human label. */
export const KNOWN_PROTOCOLS: Readonly<Record<string, string>> = knownProtocolsFile.protocols;

/** Allowances above this are treated as effectively unlimited. */
export const UNLIMITED_THRESHOLD = maxUint256 / 2n;

export const WEIGHTS = {
  unlimited: 40,
  unknownSpender: 30,
  ageOverOneYear: 20,
  ageOverSixMonths: 10,
  balanceAtRisk: 15,
} as const;

export interface ApprovalForScoring {
  token: Address;
  symbol: string;
  spender: Address;
  allowance: bigint;
  ageDays: number;
  ownerBalance: bigint;
}

export interface Finding {
  token: Address;
  symbol: string;
  spender: Address;
  spenderLabel?: string;
  /** decimal string — Finding must survive JSON.stringify for --json / agent use */
  allowance: string;
  unlimited: boolean;
  ageDays: number;
  score: number;
  reasons: string[];
}

function scoreOne(
  approval: ApprovalForScoring,
  allowlist: Readonly<Record<string, string>>,
): Finding {
  const reasons: string[] = [];
  let score = 0;

  const unlimited = approval.allowance >= UNLIMITED_THRESHOLD;
  if (unlimited) {
    score += WEIGHTS.unlimited;
    reasons.push(
      `Unlimited allowance: the spender can transfer every ${approval.symbol} this wallet ever holds`,
    );
  }

  const spenderLabel = allowlist[approval.spender.toLowerCase()];
  if (spenderLabel === undefined) {
    score += WEIGHTS.unknownSpender;
    reasons.push('Spender is not on the known-protocol allowlist');
  }

  if (approval.ageDays >= 365) {
    score += WEIGHTS.ageOverOneYear;
    reasons.push(`Approval is ${approval.ageDays} days old (over a year) — likely forgotten`);
  } else if (approval.ageDays >= 180) {
    score += WEIGHTS.ageOverSixMonths;
    reasons.push(`Approval is ${approval.ageDays} days old (over six months)`);
  }

  if (approval.ownerBalance > 0n) {
    score += WEIGHTS.balanceAtRisk;
    reasons.push(`Wallet still holds ${approval.symbol}, so this allowance is live exposure`);
  }

  return {
    token: approval.token,
    symbol: approval.symbol,
    spender: approval.spender,
    ...(spenderLabel !== undefined ? { spenderLabel } : {}),
    allowance: approval.allowance.toString(),
    unlimited,
    ageDays: approval.ageDays,
    score,
    reasons,
  };
}

/**
 * Scores each live approval and returns findings sorted by risk descending.
 * Ties break deterministically by token then spender.
 */
export function scoreApprovals(
  approvals: ApprovalForScoring[],
  allowlist: Readonly<Record<string, string>> = KNOWN_PROTOCOLS,
): Finding[] {
  return approvals
    .map((approval) => scoreOne(approval, allowlist))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.token.localeCompare(b.token) ||
        a.spender.localeCompare(b.spender),
    );
}
