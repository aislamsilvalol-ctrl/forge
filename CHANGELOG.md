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
- `CapitalLedger.append` (e o store em memória): a mesma chave de idempotência
  com o mesmo tipo e o mesmo valor devolve a entrada já gravada. Tipo ou valor
  diferente lança `IdempotencyConflictError` e não grava a segunda linha.
  `authorize` com a mesma chave e outro valor deixa de devolver o envelope
  antigo em silêncio.
- Decisão: confiança `NaN`, infinita ou fora de 0..1 é recusada. Gravar outro
  conteúdo no mesmo id lança `DecisionOverwriteError` em vez de substituir o
  registro. Uma transição que continua o histórico segue valendo.
- `release` e `commit` de uma reserva que não existe não devolvem mais uma
  posição zerada em BRL: a negativa `RESERVATION_NOT_FOUND` não traz
  `position`. Reservar numa moeda sem autorização, quando outra moeda tem
  capital autorizado, devolve `CURRENCY_MISMATCH` em vez de `NO_AUTHORIZATION`.

### Changed
- Vitest sobe de 2.1.9 para 3.2.7 (a linha 4 quebra a suíte). O passo
  `pnpm audit --audit-level high` do CI deixa de usar `continue-on-error`.
  `tinypool` 2.2.0, `vite` 6.4.4 e `source-map-js` 1.2.2 ficam fixados por
  override: são as versões corrigidas que a 3.2.7 ainda não puxa sozinha.
- README e o workspace passam a citar só os pacotes que existem
  (`@forge/domain`, `@forge/capital`, `@forge/decision`, `@forge/sentinel`).
  `@forge/sentinel` deixa de depender de `@forge/capital` sem importá-lo.
- `.gitignore` continua sem ignorar `.env.example` e deixa de repetir
  `*.tsbuildinfo`.

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
