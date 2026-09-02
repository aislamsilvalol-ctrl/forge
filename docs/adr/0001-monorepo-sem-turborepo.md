# ADR 0001 — Monorepo com pnpm workspaces, sem Turborepo por ora

**Status:** aceito · 2026-09-02

## Contexto
O Forge precisa nascer com fronteiras claras entre domínio, capital, decisão
e conectores, e precisa ser publicável como pacotes independentes.

## Decisão
pnpm workspaces. **Sem Turborepo neste momento.**

## Razão
Turborepo compra cache e orquestração de build — valor real quando há dezenas
de pacotes e a build passa de alguns minutos. Com 5 pacotes sem dependências
externas, a suíte inteira roda em segundos; adicionar Turbo agora seria
configuração sem retorno, exatamente o que o princípio anti-complexidade do
projeto proíbe.

## Quando revisitar
Quando a build completa passar de ~2 minutos ou o número de pacotes passar de
~15. A migração é aditiva (um `turbo.json`), não uma reescrita.
