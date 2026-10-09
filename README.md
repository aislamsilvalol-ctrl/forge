# Forge

**Adaptive acquisition infrastructure for autonomous advertising.**

An open-source traffic engine that observes a business, experiments with
explicitly allocated capital, learns from measured outcomes, and operates
advertising inside financial guardrails that are enforced in code — not in a
prompt.

> **Status: v0.1 foundation.** The capital, decision and safety layers are
> implemented and tested. The Meta connector, Oracle persistence and the web
> surfaces are not built yet. See [Roadmap](#roadmap) and
> [What is not built](#what-is-not-built-yet) — this README does not claim
> anything the test suite does not prove.

---

## Why this exists

Ad platforms already automate bidding. What they cannot do is optimise for
*your* economics, because they do not know them: they see a conversion event,
not the margin behind it, not the refund rate, not what that customer costs to
serve for six months.

Forge is built around the opposite premise. It reads the business — revenue per
plan, variable cost per customer, contribution margin — and treats
**profitable customer acquisition** as the reward signal, not clicks and not
raw conversions.

Two rules shape the whole architecture:

1. **The capital envelope is code.** The engine cannot spend past what a human
   authorised, and no model output can widen that limit.
2. **Nothing learns from a number it did not measure.** Every pattern carries
   its sample size, its confidence and its decay.

## Architecture

```
        USINA TRAFFIC ─────┐
                           │
   STANDALONE WEB ─────────┤
                           ▼
                    FORGE SDK / API
                           │
              ┌────────────┴────────────┐
              │                         │
      OPERATION MODEL            CAPITAL ENGINE
              │                         │
           MEMORY                 CAPITAL GUARD
              │                         │
      ADAPTIVE ENGINE                   │
              │                         │
     EXPERIMENT ENGINE ─────────────────┘
                           │
                    DECISION ENGINE
                           │
                       SENTINEL
                           │
                    META CONNECTOR
                           │
                       META ADS
```

**One engine, two surfaces.** The libraries (`@forge/domain`,
`@forge/capital`, `@forge/decision`, `@forge/sentinel`) never import the host
application. The host imports Forge. That is what lets the same decision
engine run embedded inside a platform and as a standalone product without a
fork.

## Quick start

```bash
git clone <this-repo> && cd forge
pnpm install
pnpm test
```

Requires Node 22+ and pnpm 9+. The tested packages have **no external
dependencies** — no database, no API keys, no network. That is deliberate:
the financial safety layer must be verifiable on a laptop in seconds.

## What is implemented and tested

| Package | What it does | Tests |
|---|---|---|
| `@forge/domain` | `Money` in integer minor units, branded IDs, injectable clock | 22 |
| `@forge/capital` | Capital ledger + **Capital Guard** | 42 |
| `@forge/decision` | Immutable decision ledger with an explicit state machine | 16 |
| `@forge/sentinel` | Guardrails above the agent: kill switch, staleness, step size, cooldown, duplicates, mixed currency | 17 |

The Capital Guard suite is the specification of rule number one. It proves,
among other things, that concurrent workers cannot race past the envelope,
that a retry cannot reserve twice, that a committed reservation cannot be
released, and that provider spend reported *above* what was committed is
never hidden.

### Design decisions worth reading

- **Money is never a float.** `0.1 + 0.2 !== 0.3`, and a guard that disagrees
  with the provider invoice protects nobody. See
  [`money.ts`](packages/domain/src/money.ts).
- **Position is derived, never stored.** The balance is a pure function of the
  ledger entries, so history can be replayed and reconciled.
- **Reported spend lags reality.** `available = authorised − latest API number`
  treats already-spent money as available. The guard applies a buffer over
  committed-but-unconfirmed exposure.
- **The Sentinel receives numbers, not text.** It cannot be argued with.

Full rationale in [`docs/adr/`](docs/adr/).

## What is not built yet

Stated plainly, because a README that overstates is worse than an empty one:

- **Meta connector** — not implemented. No live credential exists in this
  environment; when built it starts read-only with contract tests against
  fixtures, and mutations stay behind a dry-run flag.
- **Oracle persistence** — interfaces exist and the in-memory store is the
  reference implementation, but no Oracle implementation is written or
  verified. No container runtime is available here to run one honestly.
- **Adaptive engine, experiments, memory** — designed, not built.
- **Web surfaces** — neither the standalone dashboard nor the embedded
  integration exists yet.

## Roadmap

| Version | Scope |
|---|---|
| v0.1 | Capital guard, decision ledger, sentinel *(current)* |
| v0.2 | Meta connector, read-only + historical ingestion |
| v0.3 | Operation model and memory |
| v0.4 | Experiment engine, adaptive learning |
| v0.5 | Dry run, then guarded Meta mutations |
| v0.6 | Creative loop with the host platform |
| v1.0 | Production readiness |

## Security

The threat model and reporting process are in
[SECURITY.md](SECURITY.md). Ad copy and business content are **untrusted
input**: a campaign name can contain "ignore your instructions", so model
input and model instructions are kept strictly separate.

## License

[Apache-2.0](LICENSE) — commercial use permitted, with an explicit patent
grant.
