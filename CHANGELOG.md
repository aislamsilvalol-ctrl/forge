# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Sentinel: valor atual e proposto em moedas diferentes, ou capital em risco
  e capital autorizado em moedas diferentes, viram a violação
  `CURRENCY_MISMATCH`. `evaluate` não lança mais `CurrencyMismatchError`, e a
  fração do envelope não divide centavos de moedas distintas.

### Added
- `@forge/domain` — `Money` in integer minor units, branded IDs, injectable
  clock and ID generator.
- `@forge/capital` — capital ledger with derived positions, and the Capital
  Guard enforcing the authorised envelope under concurrency, with
  idempotency and a buffer for provider reporting lag.
- `@forge/decision` — append-only decision ledger with an explicit state
  machine; proposals require evidence and a calibrated expected range.
- `@forge/sentinel` — guardrails above the agent: kill switch, safe mode,
  data staleness, step size, capital concentration, cooldown, duplicate
  actions and daily action limits.
- Architecture Decision Records 0001–0005.

### Not yet implemented
- Meta connector, Oracle persistence, adaptive engine, experiment engine,
  and both web surfaces.
