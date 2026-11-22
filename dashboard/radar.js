// Token Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the board, the detail view and the live view. No network: every byte
// it shows is in data.js.
//
// The value model (radar-2) lives here in full, so the page states what it ranks
// by. The same function scores every row, from TVL, seven-day growth and age
// alone; no protocol name is ever special-cased:
//
//   base       = tvl_usd x 0.30
//   growth     = clamp(change_7d, -80, 200) per cent (null counts as 0)
//   growthMult = 1 + (growth / 100) x 0.6 when growth >= 0
//              = 1 + (growth / 100) x 1.0 when growth < 0
//              clamped to [0.35, 2.0]
//   maturity   = 0.60 + 0.40 x ln(1 + ageDays / 120) / ln(1 + 1460 / 120)
//   implied    = min(round(base x growthMult x maturity), tvl_usd x 0.75), at least $1

var DATA = window.RADAR;
var MODEL = DATA.model;

function ageDays(asOf, listedAt) {
  if (!listedAt) return null;
  var a = Date.parse(asOf + 'T00:00:00Z');
  var b = Date.parse(listedAt + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / 86400000));
}

/** The implied value one protocol gets under radar-2, with its three factors. */
function impliedValue(row) {
  var age = ageDays(DATA.as_of, row.listed_at);
  var raw = typeof row.change_7d === 'number' && isFinite(row.change_7d) ? row.change_7d : 0;
  var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, raw));
  var weight = growth >= 0 ? MODEL.growth_up_weight : MODEL.growth_down_weight;
  var growthMult = Math.min(MODEL.growth_mult_max, Math.max(MODEL.growth_mult_min, 1 + (growth / 100) * weight));
  var ageForModel = age === null ? MODEL.unknown_age_days : age;
  var maturityMult = MODEL.maturity_floor + MODEL.maturity_range *
    (Math.log(1 + Math.min(Math.max(ageForModel, 0), MODEL.maturity_max_days) / MODEL.maturity_scale_days) /
     Math.log(1 + MODEL.maturity_max_days / MODEL.maturity_scale_days));
  var base = row.tvl_usd * MODEL.base_multiple;
  var cap = row.tvl_usd * MODEL.implied_cap_multiple;
  var implied = Math.max(1, Math.min(Math.round(base * growthMult * maturityMult), Math.floor(cap)));
  return { implied: implied, base: Math.round(base), growth: growth, growthMult: growthMult, maturityMult: maturityMult, age: age };
}

/* ---- farm plans: the same generator main.ts runs, from the same inputs ---- */

function chainOf(row) { return row.chains.length > 0 ? row.chains[0] : 'its main chain'; }

function capitalFor(row) {
  if (row.tvl_usd >= 1000000000) return 500;
  if (row.tvl_usd >= 100000000) return 250;
  if (row.tvl_usd >= 25000000) return 150;
  return 100;
}

function gasNote(chain) {
  if (chain === 'Ethereum') return 'expect $2 to $8 of gas per transaction on Ethereum';
  return 'gas is usually under $0.50 a transaction on ' + chain;
}

function holdDaysFor(age) {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

function groupOf(row) {
  var c = (row.category || '').toLowerCase();
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
  if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0) return 'dex';
  if (c.indexOf('perpetual') >= 0 || c.indexOf('derivativ') >= 0 || c.indexOf('options') >= 0) return 'perps';
  if (c.indexOf('rwa') >= 0 || c.indexOf('real world') >= 0) return 'rwa';
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'vault';
  if (c.indexOf('prediction') >= 0) return 'prediction';
  if (c.indexOf('insurance') >= 0) return 'insurance';
  if (c.indexOf('stablecoin') >= 0) return 'stable';
  if (c.indexOf('payment') >= 0) return 'payments';
  if (c.indexOf('bridge') >= 0) return 'bridge';
  if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'yield';
  return 'deposit';
}

function mainAction(group, name, capital, chain) {
  switch (group) {
    case 'lending': return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the deposit open.';
    case 'dex': return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open.';
    case 'perps': return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    case 'rwa': return 'Mint $' + capital + ' of ' + name + '\'s yield-bearing asset on ' + chain + ' and hold it in your wallet.';
    case 'vault': return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    case 'prediction': return 'Fund your account with $' + capital + ' and place one market position on ' + name + '.';
    case 'insurance': return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    case 'stable': return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    case 'payments': return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the account active.';
    case 'bridge': return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + chain + ' and use the bridged funds in its app.';
    case 'yield': return 'Deposit $' + capital + ' into ' + name + '\'s main yield position on ' + chain + ' and keep it open.';
    default: return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
}

function secondAction(group, name, chain) {
  switch (group) {
    case 'lending': return 'Borrow $25 of USDC against the deposit on ' + name + ' and repay it a week later.';
    case 'dex': return 'Swap $25 through ' + name + '\'s main pool on ' + chain + ' in a separate transaction.';
    case 'perps': return 'Close the hedge on ' + name + ', then open one fresh small position the next day.';
    case 'rwa': return 'Claim any yield the ' + name + ' asset accrues and restake it in the same asset.';
    case 'vault': return 'Deposit a second $25 into a different ' + name + ' vault on ' + chain + '.';
    case 'prediction': return 'Settle the first market position on ' + name + ', then place one more the next week.';
    case 'insurance': return 'File a test quote on ' + name + ' for a second cover amount and let it lapse.';
    case 'stable': return 'Send $25 of the stable asset to a second wallet you own through ' + name + '.';
    case 'payments': return 'Make one more payment of $25 through ' + name + ' on ' + chain + ' the following week.';
    case 'bridge': return 'Bridge $25 back through ' + name + ' so the round trip is on record.';
    case 'yield': return 'Claim the yield ' + name + ' pays and redeposit it into the same position.';
    default: return 'Make one more $25 deposit into ' + name + ' on ' + chain + ' a week after the first.';
  }
}

function weeklyAction(group, name) {
  switch (group) {
    case 'lending': return 'Each week, top up or adjust the ' + name + ' deposit by at least $10.';
    case 'dex': return 'Each week, swap at least $10 through ' + name + '\'s pool.';
    case 'perps': return 'Each week, open and close one small position on ' + name + '.';
    case 'rwa': return 'Each week, check the yield the ' + name + ' asset paid and leave it compounding.';
    case 'vault': return 'Each week, add at least $10 to a ' + name + ' vault.';
    case 'prediction': return 'Each week, place one small market position on ' + name + '.';
    case 'insurance': return 'Each week, renew or requote cover on ' + name + ' so the policy never lapses.';
    case 'stable': return 'Each week, move at least $10 of the stable asset through ' + name + '.';
    case 'payments': return 'Each week, route one payment through ' + name + '.';
    case 'bridge': return 'Each week, bridge at least $10 through ' + name + '.';
    case 'yield': return 'Each week, claim and redeposit at least $10 of yield on ' + name + '.';
    default: return 'Each week, make one qualifying action on ' + name + ', such as a deposit, a swap or a vote.';
  }
}

function stepText(step) {
  var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
  return s;
}

/** A protocol's farm plan: seven steps, each an action with a cost and a time. */
function farmSteps(row) {
  var chain = chainOf(row);
  var capital = capitalFor(row);
  var age = ageDays(DATA.as_of, row.listed_at);
  var hold = holdDaysFor(age);
  var group = groupOf(row);
  var gas = gasNote(chain);
  return [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: mainAction(group, row.name, capital, chain), cost: '$' + capital + ' of capital; ' + gas, time: '15 minutes to set up' },
    { text: secondAction(group, row.name, chain), cost: '$25 of capital; gas under $1 on most chains', time: '10 minutes' },
    { text: weeklyAction(group, row.name), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
    { text: 'Once a week, open ' + row.name + '\'s own points or rewards page and check what it recorded; claim only from the link the protocol itself publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes a week' },
    { text: 'Write the wallet, the dates and every transaction hash in a farm log, and decide the unwind plan before any snapshot date the protocol announces.', cost: 'nothing but the log', time: '5 minutes' }
  ].map(stepText);
}

/* ---- formatting ---- */

function money(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000000) return '$' + (n / 1000000000).toFixed(2) + 'B';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + Math.round(n);
}

function pct(n) {
  if (n === null || n === undefined) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
}

function ageText(row) {
  var a = ageDays(DATA.as_of, row.listed_at);
  if (a === null) return '—';
  if (a >= 365) return (a / 365).toFixed(1) + 'y';
  return a + 'd';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---- state ---- */

var params = new URLSearchParams(location.search);
var state = {
  q: params.get('q') || '',
  category: params.get('category') || '',
  scope: params.get('scope') || 'all',
  sort: params.get('sort') || 'value',
  detail: params.get('detail') || null
};
var selected = null;

var qInput = document.getElementById('q');
var catSelect = document.getElementById('category');
var scopeSelect = document.getElementById('scope');
var sortSelect = document.getElementById('sort');
qInput.value = state.q;
scopeSelect.value = state.scope;
sortSelect.value = state.sort;

var categories = [];
DATA.rows.forEach(function (r) {
  if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
});
categories.sort();
categories.forEach(function (c) {
  var o = document.createElement('option');
  o.value = c;
  o.textContent = c;
  catSelect.appendChild(o);
});
catSelect.value = state.category;

function filteredRows() {
  var q = state.q.trim().toLowerCase();
  var rows = DATA.rows.filter(function (r) {
    if (state.scope === 'watchlist' && !r.watchlist) return false;
    if (state.scope === 'early' && r.watchlist) return false;
    if (state.category && r.category !== state.category) return false;
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  var key = state.sort;
  rows.sort(function (a, b) {
    if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
    if (key === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
    if (key === 'age') return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days);
    return a.rank - b.rank;
  });
  return rows;
}

function renderStats() {
  var top = DATA.rows[0];
  document.getElementById('stats').innerHTML =
    '<div><dt>Board rows</dt><dd>' + DATA.board_size + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + DATA.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + DATA.early_size + '</dd></div>' +
    '<div><dt>Top implied</dt><dd>' + money(top ? top.implied_value_usd : 0) + '</dd></div>';
}

function renderBoard() {
  var rows = filteredRows();
  var html = rows.map(function (r) {
    var g = r.change_7d;
    var cls = g === null ? '' : (g >= 0 ? 'up' : 'down');
    return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="selected"' : '') + '>' +
      '<td class="num">' + r.rank + '</td>' +
      '<td class="name">' + esc(r.name) + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + cls + '">' + pct(g) + '</td>' +
      '<td class="num">' + ageText(r) + '</td>' +
      '<td class="num value">' + money(r.implied_value_usd) + '</td>' +
      '<td>' + (r.watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge early">Early</span>') + '</td></tr>';
  }).join('');
  document.getElementById('rows').innerHTML = html || '<tr><td colspan="9">No protocols match this filter.</td></tr>';
  document.getElementById('count').textContent = rows.length + ' of ' + DATA.board_size + ' protocols shown.';
  document.querySelectorAll('#rows tr[data-slug]').forEach(function (tr) {
    tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug'), true); });
  });
}

function renderLive() {
  document.getElementById('live-rows').innerHTML = DATA.live.map(function (r) {
    var g = r.change_7d;
    var cls = g === null ? '' : (g >= 0 ? 'up' : 'down');
    return '<tr><td class="name">' + esc(r.name) + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num value">' + money(r.mcap_usd) + '</td>' +
      '<td class="num ' + cls + '">' + pct(g) + '</td></tr>';
  }).join('');
}

function showDetail(slug, scroll) {
  var row = null;
  DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
  if (!row) return;
  selected = slug;
  var v = impliedValue(row);
  var steps = farmSteps(row);
  var detail = document.getElementById('detail');
  detail.innerHTML =
    '<h2><span class="rank">#' + row.rank + '</span> ' + esc(row.name) + '</h2>' +
    '<p class="sub">' + esc(row.slug) + ' &middot; ' + esc(row.category || 'Uncategorised') + ' &middot; ' +
    esc(row.chains.join(', ') || 'no chain listed') + ' &middot; listed ' + esc(row.listed_at || 'unknown date') +
    ' &middot; ' + (row.watchlist ? 'on the watchlist' : 'early find below the $50M floor') + '</p>' +
    '<dl class="breakdown">' +
    '<div><dt>TVL</dt><dd>' + money(row.tvl_usd) + '</dd></div>' +
    '<div><dt>7-day change</dt><dd>' + pct(row.change_7d) + '</dd></div>' +
    '<div><dt>Age</dt><dd>' + ageText(row) + '</dd></div>' +
    '<div><dt>Base (TVL &times; 0.30)</dt><dd>' + money(v.base) + '</dd></div>' +
    '<div><dt>Growth &times;</dt><dd>&times;' + v.growthMult.toFixed(2) + '</dd></div>' +
    '<div><dt>Maturity &times;</dt><dd>&times;' + v.maturityMult.toFixed(2) + '</dd></div>' +
    '<div><dt>Implied value</dt><dd class="big">' + money(v.implied) + '</dd></div>' +
    '</dl>' +
    '<h3>How to farm it — 7 steps</h3>' +
    '<ol class="farm">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
  document.querySelectorAll('#rows tr[data-slug]').forEach(function (tr) {
    tr.classList.toggle('selected', tr.getAttribute('data-slug') === slug);
  });
  if (scroll) detail.scrollIntoView({ block: 'nearest' });
}

qInput.addEventListener('input', function () { state.q = qInput.value; renderBoard(); });
catSelect.addEventListener('change', function () { state.category = catSelect.value; renderBoard(); });
scopeSelect.addEventListener('change', function () { state.scope = scopeSelect.value; renderBoard(); });
sortSelect.addEventListener('change', function () { state.sort = sortSelect.value; renderBoard(); });

renderStats();
renderBoard();
renderLive();
if (state.detail) showDetail(state.detail, false);
// Screenshot scenes (?shot=...): the same states a click reaches, framed for
// the capture — the detail view alone, or the filtered board alone.
var shot = params.get('shot');
if (shot === 'detail') document.body.classList.add('shot-detail');
if (shot === 'filtered') document.body.classList.add('shot-filtered');
document.querySelector('main').removeAttribute('aria-busy');
