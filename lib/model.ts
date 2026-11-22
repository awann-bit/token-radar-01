// Token Radar's value model (radar-2): one snapshot of the protocol universe in,
// one ranked board out.
//
// The board ranks pre-token protocols only. Every slug in the snapshot's watchlist
// is on it (the floor, never a ceiling), plus every other pre-token protocol below
// the floor that the watchlist's own rule would keep: no token recorded, no wrapped
// or staked product, no bridge or exchange, no versioned pool. Protocols whose token
// already trades are kept apart in the dashboard's Live view, shown at the market's
// own market cap, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures — TVL, seven-day
// growth, and how long the protocol has run with no token — never from a list of
// names. The same function scores every row:
//
//   base        = tvl_usd x 0.30
//   growth      = clamp(change_7d, -80, 200) per cent (null counts as 0)
//   growthMult  = 1 + (growth / 100) x 0.6 when growth >= 0
//               = 1 + (growth / 100) x 1.0 when growth < 0   (falls bite harder)
//               clamped to [0.35, 2.0]
//   maturity    = 0.60 + 0.40 x ln(1 + ageDays / 120) / ln(1 + 1460 / 120)
//               (ageDays unknown: 365; diminishing returns — the first years of
//                surviving with no token prove more than the later ones)
//   implied     = min(round(base x growthMult x maturity), tvl_usd x 0.75), at least $1
//
// Farm plans are generated from the same record (category, first chain, TVL tier,
// age), never from a hand-written list of names.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_up_weight: number;
  growth_down_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_mult_min: number;
  growth_mult_max: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_scale_days: number;
  maturity_max_days: number;
  unknown_age_days: number;
  implied_cap_multiple: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_up_weight: 0.6,
  growth_down_weight: 1.0,
  growth_floor: -80,
  growth_cap: 200,
  growth_mult_min: 0.35,
  growth_mult_max: 2.0,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_scale_days: 120,
  maturity_max_days: 1460,
  unknown_age_days: 365,
  implied_cap_multiple: 0.75,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 16;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page generates its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; base: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_up_weight : model.growth_down_weight;
  const growthMult = Math.min(
    model.growth_mult_max,
    Math.max(model.growth_mult_min, 1 + (growthPct / 100) * weight),
  );
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    model.maturity_range *
      (Math.log(1 + Math.min(Math.max(ageForModel, 0), model.maturity_max_days) / model.maturity_scale_days) /
        Math.log(1 + model.maturity_max_days / model.maturity_scale_days));
  const base = protocol.tvl_usd * model.base_multiple;
  const cap = protocol.tvl_usd * model.implied_cap_multiple;
  const implied = Math.max(1, Math.min(Math.round(base * growthMult * maturityMult), Math.floor(cap)));
  return { implied, base: Math.round(base), growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule leaves out: wrapped, staked or bridged products, exchanges. */
const EXCLUDED_CATEGORY = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol must not begin with, per the watchlist rule. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token under the watchlist's own rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORY.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no
  // longer carries (it cannot, but the board's coverage is the gate's row).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  // Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_usd: s.base,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 100_000_000) return 250;
  if (p.tvl_usd >= 25_000_000) return 150;
  return 100;
}

/** Gas wording for the protocol's first chain: Ethereum costs real money, the rest do not. */
function gasNote(chain: string): string {
  if (chain === 'Ethereum') return 'expect $2 to $8 of gas per transaction on Ethereum';
  return `gas is usually under $0.50 a transaction on ${chain}`;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category group a protocol's farm plan is built from. */
function groupOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('amm')) return 'dex';
  if (c.includes('perpetual') || c.includes('derivativ') || c.includes('options')) return 'perps';
  if (c.includes('rwa') || c.includes('real world')) return 'rwa';
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return 'vault';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('stablecoin')) return 'stable';
  if (c.includes('payment')) return 'payments';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  return 'deposit';
}

/** The main qualifying action for a category group. */
function mainAction(group: string, name: string, capital: number, chain: string): string {
  switch (group) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} and keep the deposit open.`;
    case 'dex':
      return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
    case 'rwa':
      return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
    case 'vault':
      return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
    case 'prediction':
      return `Fund your account with $${capital} and place one market position on ${name}.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    case 'payments':
      return `Route $${capital} of payments through ${name} on ${chain} and keep the account active.`;
    case 'bridge':
      return `Bridge $${capital} of USDC through ${name} to ${chain} and use the bridged funds in its app.`;
    case 'yield':
      return `Deposit $${capital} into ${name}'s main yield position on ${chain} and keep it open.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** A second, different qualifying action for a category group. */
function secondAction(group: string, name: string, chain: string): string {
  switch (group) {
    case 'lending':
      return `Borrow $25 of USDC against the deposit on ${name} and repay it a week later.`;
    case 'dex':
      return `Swap $25 through ${name}'s main pool on ${chain} in a separate transaction.`;
    case 'perps':
      return `Close the hedge on ${name}, then open one fresh small position the next day.`;
    case 'rwa':
      return `Claim any yield the ${name} asset accrues and restake it in the same asset.`;
    case 'vault':
      return `Deposit a second $25 into a different ${name} vault on ${chain}.`;
    case 'prediction':
      return `Settle the first market position on ${name}, then place one more the next week.`;
    case 'insurance':
      return `File a test quote on ${name} for a second cover amount and let it lapse.`;
    case 'stable':
      return `Send $25 of the stable asset to a second wallet you own through ${name}.`;
    case 'payments':
      return `Make one more payment of $25 through ${name} on ${chain} the following week.`;
    case 'bridge':
      return `Bridge $25 back through ${name} so the round trip is on record.`;
    case 'yield':
      return `Claim the yield ${name} pays and redeposit it into the same position.`;
    default:
      return `Make one more $25 deposit into ${name} on ${chain} a week after the first.`;
  }
}

/** The weekly recurring action for a category group. */
function weeklyAction(group: string, name: string): string {
  switch (group) {
    case 'lending':
      return `Each week, top up or adjust the ${name} deposit by at least $10.`;
    case 'dex':
      return `Each week, swap at least $10 through ${name}'s pool.`;
    case 'perps':
      return `Each week, open and close one small position on ${name}.`;
    case 'rwa':
      return `Each week, check the yield the ${name} asset paid and leave it compounding.`;
    case 'vault':
      return `Each week, add at least $10 to a ${name} vault.`;
    case 'prediction':
      return `Each week, place one small market position on ${name}.`;
    case 'insurance':
      return `Each week, renew or requote cover on ${name} so the policy never lapses.`;
    case 'stable':
      return `Each week, move at least $10 of the stable asset through ${name}.`;
    case 'payments':
      return `Each week, route one payment through ${name}.`;
    case 'bridge':
      return `Each week, bridge at least $10 through ${name}.`;
    case 'yield':
      return `Each week, claim and redeposit at least $10 of yield on ${name}.`;
    default:
      return `Each week, make one qualifying action on ${name}, such as a deposit, a swap or a vote.`;
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const group = groupOf(p);
  const gas = gasNote(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mainAction(group, p.name, capital, chain),
      cost: `$${capital} of capital; ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(group, p.name, chain),
      cost: '$25 of capital; gas under $1 on most chains',
      time: '10 minutes',
    },
    {
      text: weeklyAction(group, p.name),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a week, open ${p.name}'s own points or rewards page and check what it recorded; claim only from the link the protocol itself publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a week',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and decide the unwind plan before any snapshot date the protocol announces.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_usd: row.model.base_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
