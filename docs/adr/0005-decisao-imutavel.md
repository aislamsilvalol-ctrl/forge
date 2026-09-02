# ADR 0005 — Extrato de decisões imutável com máquina de estados explícita

**Status:** aceito · 2026-09-02

## Contexto
O motor precisa aprender com o que deu errado, e o operador precisa auditar
o que foi feito com o dinheiro dele.

## Decisão
Decisões nunca são sobrescritas: cada mudança acrescenta uma transição.
Transições válidas são declaradas numa tabela; saltos são rejeitados.

## Razão
Se `status` fosse um campo mutável, o histórico poderia ser reescrito para
parecer melhor do que foi — e o aprendizado passaria a treinar sobre uma
ficção. A tabela explícita impede que uma proposta rejeitada "volte" a ser
executada por um caminho não previsto.

Toda proposta exige evidência e uma **faixa** esperada, não um ponto:
previsão pontual finge uma certeza que não existe, e impede medir calibração.

## Consequências
`outcomeWithinExpectation` compara o observado com a faixa prevista — é a
base da recompensa do aprendizado adaptativo.
