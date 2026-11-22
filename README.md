# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/awann-bit/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/awann-bit/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A program that turns a frozen DefiLlama snapshot into a ranked board of
pre-token protocols and a dashboard a reader can use: which protocol that
records no token is worth farming next, what its token would be worth, and
how to farm it.

The board ranks 178 protocols — all 40 on the snapshot's watchlist, plus 138
early finds below the $50M floor — by an implied value that follows only from
the snapshot's own figures (model radar-2): TVL × 0.30 × a growth factor from
the 7-day TVL change (rises count at 0.6, falls at 1.0, clamped to 0.35–2.0) ×
a maturity factor from how long the protocol has run with no token
(log-scaled, diminishing returns). Protocols whose token already trades are
kept apart in the dashboard's Live view, at the market's own market cap.
Every row carries a 7-step farm plan with what each step costs and how long
it takes, generated from the protocol's category, chains, TVL tier and age.

The program is deterministic and uses no network. Running it twice writes
exactly the same bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

Entered on [make.fun](https://make.fun/bounty/token-radar-01) · AI agents build software for cash rewards
