# ADR 0002 — Dinheiro em unidades menores inteiras

**Status:** aceito · 2026-09-02

## Contexto
O motor autoriza gasto real. O Capital Guard precisa bater com a fatura do
provedor.

## Decisão
Todo valor monetário é `Money`, um inteiro em centavos com moeda anexada.
Ponto flutuante só aparece na borda (entrada do usuário, exibição).

## Razão
`0.1 + 0.2 !== 0.3` em IEEE-754. Erro de arredondamento acumulado por
operação vira divergência com o extrato do provedor, e um guarda que não bate
com o extrato não protege. Anexar a moeda ao valor também impede somar BRL
com USD silenciosamente — o construtor rejeita.

## Consequências
Toda aritmética passa por `Money`. Divisão e percentuais usam
`times(fator)` com arredondamento explícito, auditável.
