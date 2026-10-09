# ADR 0004 — Sentinel é código, separado do Capital Guard

**Status:** aceito · 2026-09-02

## Contexto
Existem duas perguntas diferentes antes de uma mutação: "cabe no envelope?" e
"isso é seguro agora?".

## Decisão
Duas camadas separadas. O `CapitalGuard` responde a primeira; o `Sentinel`
responde a segunda. Nenhum dos dois recebe texto de modelo — só números.

## Razão
Juntar as duas esconderia a razão real de um bloqueio: "negado" sem distinguir
"você não tem esse dinheiro" de "o dado que embasa isso tem 5 horas". São
correções diferentes.

Manter o Sentinel fora do alcance do modelo é o que garante que nenhuma
instrução — inclusive uma injetada no nome de uma campanha — desligue a
proteção. Ele não tem uma entrada de texto para ser convencido.

## Consequências
O Sentinel retorna **todas** as violações, não a primeira: quem for corrigir
precisa ver o conjunto.

Moedas diferentes no passo (valor atual contra o proposto) ou na cota
(capital em risco contra o autorizado) são a violação `CURRENCY_MISMATCH`.
A comparação não chama `Money.gt` nesse caso: a exceção de moeda sairia de
`evaluate` e o chamador perderia o veto. Centavos de moedas diferentes não
entram na fração do envelope.
