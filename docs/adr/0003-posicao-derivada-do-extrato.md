# ADR 0003 — Posição de capital derivada, nunca armazenada

**Status:** aceito · 2026-09-02

## Contexto
Precisamos saber a qualquer momento quanto o motor ainda pode gastar.

## Decisão
`derivePosition(entries)` é função pura sobre o extrato. Não existe coluna
`saldo` mutável.

## Razão
Um saldo armazenado pode divergir das entradas — por bug, corrida ou escrita
manual — e a divergência é invisível. Derivando, o histórico é reprocessável:
dá para reconciliar contra a fatura do provedor e explicar cada centavo.

O custo é recalcular a cada consulta. Com o volume de um workspace de
anúncios isso é irrelevante; se um dia deixar de ser, a resposta é
*snapshot* periódico com as entradas preservadas — não substituir o extrato.

## Consequências
`SPEND` acima do `COMMIT` não deixa `committed` negativo: um negativo
abateria a exposição e mostraria menos dinheiro fora do que realmente saiu.
Um teste guarda esse comportamento.

`RELEASE` ou `COMMIT` que deixariam `reserved` negativo são recusados na
escrita. Se o extrato já chegou assim, `reserved` continua a soma (a
divergência fica visível) e a exposição usa só a parte não negativa — um
reservado negativo não devolve capital.
