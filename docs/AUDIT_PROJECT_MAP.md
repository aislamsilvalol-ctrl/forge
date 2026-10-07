# Mapa de auditoria — Forge

Auditoria somente leitura do repositório `aislamsilvalol-ctrl/forge` no commit `f8ca3dd` (`main`, 2026-09-03). Nenhum código de aplicação foi alterado. Achados abaixo foram lidos no código, nos ADRs, no workflow de CI e no histórico git, e os caminhos de dinheiro citados na seção 3 foram reproduzidos localmente contra o `dist` gerado por `pnpm build` (Node 22.14.0, pnpm 9.15.9). Não há valor de segredo neste documento: não existe literal de credencial no tree rastreado.

---

## 1. PROJECT MAP

### O que o projeto é

Forge é a fundação v0.1 de um motor de aquisição de mídia paga. A premissa, em `README.md:1-35` e no commit `9e07ff5`, é autorizar gasto de anúncio dentro de um envelope de capital imposto em código, não num prompt. O que existe hoje é uma biblioteca TypeScript sem I/O: dinheiro em centavos inteiros, extrato de capital, guarda de reserva, extrato de decisões e um veto (Sentinel).

O próprio README delimita o que não existe (`README.md:10-14` e `README.md:111-123`):

- conector Meta
- persistência Oracle
- motor adaptativo, experimentos e memória
- dashboard standalone e integração embutida

`CHANGELOG.md:22-25` repete a mesma lista. Não há, neste repositório, frontend, API HTTP, banco, ORM, autenticação, fila, webhook, bot Telegram, Mini App, painel admin, cron, cache, storage de objeto nem manifesto de deploy.

### O forge é tooling compartilhado?

Não, no que este repositório e a conta pública permitem verificar.

Forge é um monorepo de bibliotecas pensado para ser **importado** por um host, não um kit já ligado a outros produtos. `README.md:65-68` diz que o host importa o Forge e que o núcleo não importa a aplicação. O nome usado ali é `@forge/core`. Esse pacote **não existe**. Os pacotes publicados no workspace são `@forge/domain`, `@forge/capital`, `@forge/decision` e `@forge/sentinel`.

O desenho de host futuro está no diagrama de `README.md:39-63`: "USINA TRAFFIC" e "STANDALONE WEB" em cima de "FORGE SDK / API", descendo até "META ADS". Nenhum desses blocos abaixo de Sentinel tem código. `pnpm-workspace.yaml:1-4` declara `packages/*`, `connectors/*` e `apps/*`, mas só `packages/` existe no disco. Não há diretório `apps/` nem `connectors/`.

Conta pública `aislamsilvalol-ctrl`, consultada em 2026-10-07 via GitHub API:

| Repositório | O que é | Liga com este forge? |
|---|---|---|
| `forge` | este repo | — |
| `noema` | plataforma de estudo (FastAPI, Next.js, Postgres + pgvector; `apps/api/pyproject.toml` depende de SQLAlchemy, Alembic, Redis, Dramatiq, Stripe, boto3) | não. O tree não contém `@forge/`. O único path que casa a substring `forge` é `sabelia/sabelia/memory/forgetting.py` |
| `isahat` | auditor de segurança | sem referência a este repo no que a listagem pública mostra |
| `sabelia` | motor de modelagem de aprendizagem | idem |
| `isla` | radar de viralidade | idem |
| `aislamsilvalol-ctrl` | perfil / site | sem código de produto |

`gateway-do-7`, `cartoes-do-7` e `sala-do-trono` **não resolvem** como repositórios de `aislamsilvalol-ctrl` com o token desta sessão (a API responde que o repositório não existe). Este código não cita esses nomes. Não dá para afirmar nada sobre repositórios privados invisíveis a este token. Dá para afirmar que este forge não é, hoje, uma dependência compartilhada já consumida pelos projetos públicos do mesmo dono, e que `noema` é outro produto (aprendizado adaptativo, com Stripe próprio), não um host do Forge.

Busca pública por `@forge/domain` encontra outros repositórios não relacionados (`nibzard/forge`, `broken-shield-llc/bitcraft-forge`, `RAndres1/Forge`, entre outros) que reutilizam o escopo npm por coincidência. Não são este código.

### Stack e layout

Monorepo pnpm, sem Turborepo. ADR `docs/adr/0001-monorepo-sem-turborepo.md` (aceito em 2026-09-02) justifica: poucos pacotes, suíte em segundos, Turbo seria configuração sem retorno.

| Peça | Onde | Fato |
|---|---|---|
| Runtime | `package.json:6-8`, `.nvmrc` | Node `>=22`; `.nvmrc` contém `22` |
| Package manager | `package.json:5` | `pnpm@9.15.9`, fonte única de versão (commit `b656d52`) |
| Linguagem | `tsconfig.base.json` | TypeScript strict, `NodeNext`, `composite`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` |
| Testes | `vitest` 2.1.9 no lock; cada pacote tem `vitest.config.ts` | 58 testes, sem rede e sem banco |
| Lint | `package.json:13` | `lint` é alias de `typecheck`. Não há ESLint, Prettier nem hook de pre-commit |
| Licença | `LICENSE` | Apache-2.0 |
| Versão dos pacotes | `packages/*/package.json` | `0.1.0` em todos |

Grafo de módulos (dependência de pacote e o que o fonte realmente importa):

```
@forge/domain
    ↑
    ├── @forge/capital        (importa Money, Clock, IDs)
    │       ↑
    │       └── @forge/sentinel   package.json e tsconfig referenciam capital,
    │                             mas sentinel.ts só importa @forge/domain
    └── @forge/decision       (importa tipos de domínio; não chama o Guard)
```

Não há ciclo. Também não há composição: nada chama `CapitalGuard` a partir de `DecisionLedger` ou `Sentinel`. Os três núcleos são bibliotecas vizinhas.

`packages/sentinel/package.json:21-24` declara dependência de `@forge/capital`. `packages/sentinel/tsconfig.json:11-17` referencia `../domain` e `../capital`. `packages/sentinel/src/sentinel.ts:14` importa só `@forge/domain`. A aresta para capital é morta.

### Frontend, backend, dados, auth, APIs, workers

Não implementados. Interfaces internas que antecipam isso:

- `CapitalLedgerStore` e `ReservationStore` em `packages/capital/src/ledger.ts:70-77` e `packages/capital/src/guard.ts:61-64`. A única implementação é `InMemoryCapitalLedgerStore` / `InMemoryReservationStore` (`packages/capital/src/memory-store.ts`). O comentário nas linhas 4-8 diz que não é mock: é a implementação de referência, e uma Oracle futura teria de passar na mesma suíte. Essa Oracle não foi escrita.
- `DecisionStore` em `packages/decision/src/decision.ts:124-128`, com `InMemoryDecisionStore` nas linhas 267-278.
- `Mutex` em `packages/capital/src/guard.ts:66-87`. Comentário na linha 66: trava em memória no V1; Oracle/Redis quando houver múltiplos nós. `InProcessMutex` não atravessa processo.
- `ActionHistory` em `packages/sentinel/src/sentinel.ts:75-85`, memória nas linhas 200-239.

Não há schema SQL, migration, Prisma, Drizzle, Redis, fila, webhook, cliente HTTP nem SDK da Meta.

### Dinheiro

Há contabilidade de **orçamento de anúncio**, não um gateway de pagamento. Não há Stripe, PIX, cartão, saldo de usuário nem webhook de provedor de pagamento. O dinheiro é o tipo `Money` (`packages/domain/src/money.ts`) e o extrato `AUTHORIZE | REVOKE | RESERVE | RELEASE | COMMIT | SPEND` (`packages/capital/src/ledger.ts:10-17` e `28-34`).

### Deploy, CI/CD, ambiente, segredos, observabilidade

- CI: um job `verify` em `.github/workflows/ci.yml`. Dispara em `push` para `main` e em `pull_request`. Passos: checkout, pnpm, Node via `.nvmrc`, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm audit --audit-level high` com `continue-on-error: true` (linhas 43-45).
- Permissão do token: `contents: read` (linhas 8-9), adicionada em `f8ca3dd`.
- Actions pinadas por SHA, com comentário de versão: checkout `v4.4.0`, `pnpm/action-setup` `v4.4.0`, `setup-node` `v4.4.0` (`ci.yml:19-28`).
- Dependabot: `.github/dependabot.yml`, semanal para npm e mensal para Actions. Entrou no commit de fundação `9e07ff5`, não no `f8ca3dd` (esse commit só altera `ci.yml`, apesar do assunto mencionar dependabot).
- Não há workflow de release, publish no npm, Docker, Compose, Terraform ou manifesto Kubernetes.
- Variáveis de ambiente: nenhum `process.env` no fonte. `.gitignore:5-7` ignora `.env` e `.env.*`, com exceção `!.env.example`. Não existe `.env.example`.
- Segredos no tree rastreado: busca por padrões de chave privada, token de API e prefixos comuns não achou ocorrência. `SECURITY.md:33-38` descreve política futura (não logar, cifrar em repouso, rotação). Não há código que cifre ou carregue segredo.
- Observabilidade: não há logger, OpenTelemetry, métrica ou tracing. Falhas são `Error` com mensagem em português, ou `GuardOutcome` / `SentinelVerdict` com `detail` textual.

### Testes que existem

| Pacote | Arquivo | `it(` |
|---|---|---|
| `@forge/domain` | `packages/domain/test/money.test.ts` | 15 |
| `@forge/capital` | `packages/capital/test/guard.test.ts` | 18 |
| `@forge/decision` | `packages/decision/test/decision.test.ts` | 12 |
| `@forge/sentinel` | `packages/sentinel/test/sentinel.test.ts` | 13 |

Total 58, igual ao que o commit `9e07ff5` declara. Não há teste de `packages/domain/src/ids.ts` (IDs, `Clock`, geradores). Não há teste de contrato separado do store: a suíte de capital instancia a memória direto (`guard.test.ts:26-43`).

### Histórico git

Só existem quatro commits, todos de `aislamsilvalol-ctrl`, entre 2026-09-02 e 2026-09-03. Não há 30 commits.

| SHA | Data | Assunto | Efeito verificado |
|---|---|---|---|
| `9e07ff5` | 2026-09-02 | `feat: fundação do Forge` | Introduz os quatro pacotes, ADRs 0001–0005, CI inicial, Dependabot, templates. CI [run 33645569251](https://github.com/aislamsilvalol-ctrl/forge/actions/runs/33645569251) **falhou**: a action de pnpm abortou com "Multiple versions of pnpm specified" (versão no `package.json` e na action) |
| `b656d52` | 2026-09-02 | `ci: deixa o packageManager ser a única fonte da versão do pnpm` | Tira a versão duplicada. CI [run 33645858078](https://github.com/aislamsilvalol-ctrl/forge/actions/runs/33645858078) **falhou** no typecheck: `TS2307 Cannot find module '@forge/domain'` em `decision`, `capital` (`guard.ts`, `ledger.ts`, `memory-store.ts`). O script era `pnpm -r typecheck` (`tsc -p --noEmit`) **antes** do build. Os pacotes resolvem `@forge/domain` para `dist/` (`packages/domain/package.json:4-7`). No CI limpo o `dist` não existia. Local passava se uma build anterior tivesse ficado em cache |
| `f2ead63` | 2026-09-02 | `ci: project references resolvem a ordem entre pacotes` | Passa `build` e `typecheck` para `tsc -b` / `tsc -b --force` (`package.json:9-14`), cria `tsconfig.json` raiz com `references` na ordem domain → capital → decision → sentinel, e adiciona `references` nos pacotes dependentes. `tsconfig.base.json` já tinha `composite: true`. CI [run 33646588646](https://github.com/aislamsilvalol-ctrl/forge/actions/runs/33646588646) **verde** (build, typecheck, test, audit) |
| `f8ca3dd` | 2026-09-03 | `ci: least-privilege token, actions pinned by SHA, dependabot (#6)` | `permissions: contents: read` e SHAs nas actions. CI [run 33767423118](https://github.com/aislamsilvalol-ctrl/forge/actions/runs/33767423118) **verde**. É a ponta de `main` |

Saúde da CI em 2026-10-07:

- `main` está verde desde `f2ead63`. O conserto de project references segurou a ordem de build. O problema original era real e está explicado na mensagem desse commit.
- O job de `main` não voltou a rodar depois de 2026-09-03. O que roda desde então é Dependabot.
- PRs abertos: [#8](https://github.com/aislamsilvalol-ctrl/forge/pull/8), [#9](https://github.com/aislamsilvalol-ctrl/forge/pull/9) e [#10](https://github.com/aislamsilvalol-ctrl/forge/pull/10) sobem checkout / setup-node / pnpm action e a CI deles ficou verde; continuam sem merge. [#7](https://github.com/aislamsilvalol-ctrl/forge/pull/7) sobe Vitest 2.1.9 → 4.1.11 e **falha**: `ERR_PACKAGE_PATH_NOT_EXPORTED` em `vite` (`module-runner`), run [34364992512](https://github.com/aislamsilvalol-ctrl/forge/actions/runs/34364992512). [#4](https://github.com/aislamsilvalol-ctrl/forge/pull/4) (grupo de devDependencies) também falhou. [#5](https://github.com/aislamsilvalol-ctrl/forge/pull/5) (Vitest 3.2.6) foi fechado sem merge.
- O log do run verde de `f2ead63` e o do Vitest 4 avisam que as actions pinadas em SHA de major 4 ainda declaram Node 20, e o runner força Node 24.

---

## 2. Classificação das features

| Feature | Classe | Evidência |
|---|---|---|
| `Money` em centavos, soma, comparação, moeda incompatível rejeitada | FUNCIONA | `packages/domain/src/money.ts:68-115`; 15 testes em `money.test.ts`. Aresta `fromMajor` / `times` está em RISCO |
| Posição derivada do extrato no caminho feliz (authorize → reserve → commit → spend) | FUNCIONA | `derivePosition` em `ledger.ts:84-138`; teste `guard.test.ts:265-277` |
| Teto de capital quando cada reserva tem exatamente uma entrada `RESERVE` | FUNCIONA | `guard.test.ts:46-80` e concorrência `82-113` |
| Serialização in-process por workspace | FUNCIONA | `InProcessMutex` `guard.ts:71-87`; testes de `Promise.all` passam. Não cobre dois processos (RISCO) |
| Idempotência da **linha** de extrato pela chave | FUNCIONA | `ledger.ts:181-187`; teste de authorize `guard.test.ts:127-133` e de reserve olhando só `reserved` (`115-125`) |
| Idempotência da **reserva** (o objeto que depois sofre commit/release) | QUEBRADO | `guard.ts:216-238` não grava `reservationId` na entrada. Retry devolve outro id. Reproduzido: ver seção 3 |
| Colisão da mesma chave entre `AUTHORIZE` e `RESERVE` | QUEBRADO | `ledger.ts:181-186` devolve a entrada antiga sem olhar `kind` nem valor. Reproduzido: reserve "permitido" com `reserved = 0` |
| `recordSpend` | PARCIAL | Grava gasto e não esconde estouro (`guard.test.ts:211-224`), mas a chave de idempotência é opcional (`guard.ts:320-329`) e o `reservationId` não liquida a reserva |
| `revoke` | PARCIAL | Reduz o teto (`ledger.ts:100-102`, teste `250-263`). Sem chave de idempotência (`guard.ts:127-136`): retry reduz duas vezes. Falha fechada (disponível cai) |
| `committed` não fica negativo | FUNCIONA | `ledger.ts:114-122`, ADR `docs/adr/0003-posicao-derivada-do-extrato.md:21-24` |
| `reserved` não fica negativo | QUEBRADO | `ledger.ts:103-112` não tem o piso que `committed` tem. O retry da seção 3 chega a `reserved = -30` e `exposure = 0` com `committed = 30` |
| Máquina de estados da decisão, no uso sequencial | FUNCIONA | `decision.ts:107-122`; 12 testes |
| Extrato de decisão "nunca sobrescrito" | PARCIAL | Cada transição copia `transitions` (`decision.ts:203-212`), mas `InMemoryDecisionStore.save` substitui o registro por id (`267-271`). Duas transições concorrentes leem o mesmo status no `await` de `get` e a última escrita apaga a outra |
| Proposta exige evidência e faixa | FUNCIONA | `decision.ts:157-168`. `confidence: NaN` passa: a comparação com `NaN` é falsa (`163-165`). Reproduzido |
| Sentinel (kill switch, dado velho, passo, cota, cooldown, duplicata, limite diário) | FUNCIONA | `sentinel.ts:98-197` e 13 testes, como função pura de números **se** o chamador passar estado e histórico verdadeiros |
| Kill switch / safe mode como controle do sistema | PARCIAL | São campos do argumento `SentinelState` (`sentinel.ts:55-58`, `105-121`). Não há persistência nem trava que impeça o chamador de passar `false` |
| Histórico do Sentinel | PARCIAL | `record()` (`sentinel.ts:223-234`) é método à parte. `evaluate` não registra a ação. Quem esquecer `record` desliga cooldown, duplicata e limite diário |
| Ligação decisão → Sentinel → Capital Guard → provedor | LEGADO não; está ausente | Não há orquestrador. `EXECUTED` não reserva capital. Classe correta: **não construído**, tratado como PARCIAL do produto prometido no README, não como regressão de algo que já rodou |
| Conector Meta, Oracle, web, experimentos | não construído | `README.md:111-123`. Não classificar como quebrado |
| Store em memória | FUNCIONA como referência | `memory-store.ts:4-8`. Não é legado abandonado |
| CI de `main` com project references | FUNCIONA | run `33646588646` e `33767423118` |
| `pnpm audit` barrando vulnerabilidade alta | QUEBRADO como controle | `ci.yml:43-45` usa `continue-on-error: true`. Auditoria local saiu 1 (seção 6) |
| README como mapa do código | PARCIAL | Cita `@forge/core` (`README.md:65`), que não existe. Tabela marca testes de `@forge/domain` como "—" (`README.md:86`); o pacote tem 15 testes |
| Workspace `apps/*` e `connectors/*` | PARCIAL | `pnpm-workspace.yaml:3-4` aponta para diretórios que não existem |

Não há feature antiga substituída por outra. Não há `TODO`/`FIXME` no fonte (seção 5).

---

## 3. Dinheiro

O produto mexe com orçamento. A regra declarada é não gastar além do autorizado (`ledger.ts:3-8`, ADR 0002 e 0003). O caminho feliz testado cumpre isso. Três mecanismos não cumprem.

### Float

Aritmética interna é inteira (`money.ts:27-44`, `68-76`). Isso está certo e testado (`money.test.ts:13-29`).

Float entra na borda e no fator:

- `Money.fromMajor` faz `Math.round(major * 100)` (`money.ts:51-56`). Reproduzido: `fromMajor(1.005, "BRL").minor === 100`, porque `1.005 * 100` em IEEE-754 é `100.49999999999999` e `Math.round` cai para 100. O centavo some antes de virar inteiro. `0.1`, `0.2`, `0.29`, `1.015`, `19.99` e `33.33` acertaram nesta sessão; o buraco não é "todo decimal", é "qualquer decimal cujo `n * 100` caia do lado errado do meio".
- `times` faz `Math.round(this.minor * factor)` (`money.ts:78-83`). O teste `money.test.ts:31-36` documenta `3333 * 0.1 → 333` de propósito. Fator que não é decimal exato também arredonda em silêncio. O colchão do Guard usa esse método (`guard.ts:158-161`).

Não há `number` solto guardando saldo. `Evidence.value` e `ProposedOutcome` são `number` (`decision.ts:43-56`), métrica, não saldo.

### Atualização de saldo fora de transação

Não existe coluna de saldo. `derivePosition` recalcula (`ledger.ts:84-138`). Isso evita o lost-update clássico de `saldo = saldo + x`.

O que existe no lugar:

- `append` faz read-then-insert da chave de idempotência (`ledger.ts:181-201`) sem transação no store. Dentro de um único `InProcessMutex` e de um único processo, o trecho até o primeiro `await` do mutex é síncrono e a suíte de corrida passa (`guard.test.ts:82-113`). Dois `CapitalGuard` no mesmo store não compartilham mutex: o default é `new InProcessMutex()` por instância (`guard.ts:106`). Dois processos não compartilham nada. O comentário em `guard.ts:66` admite isso.
- `reserve` faz `append` e só depois `reservations.save` (`guard.ts:216-237`). Se `save` falha no meio, o extrato tem `RESERVE` e o store de reservas não tem o objeto. Não há transação entre os dois stores.

### Idempotência

A chave é opcional em todo lugar (`AppendOptions`, `ledger.ts:140-144`). Quando presente, o store devolve a entrada antiga e não cria outra (`memory-store.ts:21-23`, `ledger.ts:181-187`). O teste `guard.test.ts:115-125` só olha `position.reserved`. Não olha identidade da reserva.

Reprodução (buffer default `0.1` e buffer `0`), envelope de R$ 100, `reserve(30, key)` duas vezes:

1. A segunda chamada é `allowed: true` com **outro** id (`res-1` e `res-2` na primeira execução; o store fica com duas reservas `OPEN`).
2. `commit` da segunda e `release` da primeira são ambos `allowed: true`, porque cada uma ainda está `OPEN` (`guard.ts:251-275` e `288-312` só olham o estado da reserva, não se já existe um `COMMIT`/`RELEASE` correspondente no extrato).
3. Posição resultante: `authorized = 100`, `reserved = -30`, `committed = 30`, `spent = 0`, `exposure = 0`, `available = 100`.
4. Com `pendingBufferRatio: 0` (o valor que a suíte usa em `guard.test.ts:26`), uma nova `reserve(100)` é **aceita**. Com o default `0.1`, `reserve(97)` é aceita. Nos dois casos o comprometido de 30 continua no extrato e o novo reserve cabe porque `exposure` foi a zero: `reserved` negativo cancela `committed` na soma de `ledger.ts:127`.

Por que a entrada não carrega a reserva: `append` do `RESERVE` recebe só `idempotencyKey` (`guard.ts:216-222`). `reservationId` é criado **depois** (`229-237`) e nunca escrito de volta na entrada. No retry, `entry.reservationId` é `undefined`, o lookup das linhas 224-227 não acha nada, e uma reserva nova é salva sem nova linha de extrato.

Colisão de chave, também reproduzida: `authorize(..., "same-key")` e depois `reserve(..., "same-key")`. O reserve volta `allowed: true`, o store de reservas tem 1 objeto, `reserved` fica `0`, e o extrato só tem `AUTHORIZE`. O chamador acredita que separou capital. Um `commit` dessa reserva aplica `COMMIT` sem `RESERVE` prévio e repete o mesmo desequilíbrio (`reserved` negativo).

`recordSpend` sem chave soma de novo. Como `committed` tem piso zero (`ledger.ts:120-122`), o segundo spend não é absorvido: `spent` cresce e `exposure` sobe. Isso **fecha** novas reservas (errado para reconciliação, seguro para o teto). `revoke` sem chave reduz o autorizado duas vezes, também fecha. Os dois são furos de reconciliação, não o bypass do retry.

### Webhook

Não há webhook, nem handler, nem verificação de assinatura. `recordSpend` é a função que um webhook futuro chamaria (`guard.ts:315-329`). Hoje ela aceita qualquer valor positivo, em qualquer moeda, com `reservationId` opcional que só vai para o meta da entrada. Não confere se a reserva está `COMMITTED`, não move a reserva de estado, não exige chave.

### Reconciliação

`derivePosition` é reprocessável e o teste `guard.test.ts:265-277` trava isso. Não há job que compare a soma de `SPEND` com uma fatura, nem vínculo `SPEND` → reserva. Vários `COMMIT` compartilham um único balde `committed`; um `SPEND` abate o balde inteiro, não a reserva citada. O `reservationId` em `recordSpend` não entra no `switch` de `derivePosition`.

### Concorrência

Uma instância, um processo: o mutex segura o teto. A suíte prova 2 e 10 reservas paralelas (`guard.test.ts:82-113`).

Fora isso o desenho não segura:

- mutex por objeto, não por store
- sem trava entre `release`/`commit` e outro processo
- `DecisionLedger.transition` não tem mutex (`decision.ts:192-212`)
- `InMemoryActionHistory.record` não é `await`-serializado com `evaluate`; o chamador é que tem de lembrar de gravar depois

### Colchão negativo

`pendingBufferRatio` default é `0.1` (`guard.ts:109`) e não é validado. Reproduzido com `-1`: authorize 100, reserve 50, commit, `spendableNow` devolve **100** e `reserve(100)` é aceito. `applyBuffer` (`guard.ts:158-164`) faz `available.minus(buffer)`; buffer negativo aumenta o gastável acima do disponível. O default não dispara isso. Quem passar a opção dispara.

`CURRENCY_MISMATCH` está no tipo `DenialReason` (`guard.ts:34-40`) e em nenhum `return`. Reserva em outra moeda cai em `NO_AUTHORIZATION`, porque a posição daquela moeda tem `authorized` zero (`guard.ts:191-201`).

`notFound` devolve uma posição zerada **em BRL** (`guard.ts:332-348`), mesmo quando a reserva que faltou nem existe para saber a moeda.

---

## 4. Segurança

Não há superfície HTTP. Os itens abaixo são o que o código faz hoje, mais o que `SECURITY.md` promete e ainda não tem implementação.

### Autenticação e autorização

Inexistentes. Não há usuário, sessão, token nem middleware. `SECURITY.md:19` lista isolamento de tenant como ativo a proteger. No código, `workspaceId` é um argumento do chamador (`guard.ts:113-118`, `decision.ts:131`). Qualquer código que importe a lib escolhe o workspace. Isso é aceitável numa biblioteca pura; não é controle de acesso.

### RBAC no servidor

Não há servidor, nem papel, nem checagem. O "operador" que autoriza capital é quem chama `authorize` (`guard.ts:112-125`). Não há distinção de papel entre quem amplia o envelope e quem reserva.

### IDOR

Não há identificador de recurso HTTP. O análogo interno: `release` e `commit` carregam só `reservationId` (`guard.ts:243-246`, `282-285`). O store de memória é um `Map` global (`memory-store.ts:48-55`), sem conferir o workspace do chamador, porque não há chamador autenticado. Quando houver API, esse par de métodos é o ponto de IDOR se o handler não filtrar por tenant.

### Mass assignment

`meta?: Readonly<Record<string, unknown>>` é copiado para a entrada e para a decisão (`ledger.ts:199`, `decision.ts:186`). Não há schema. Hoje não há request HTTP que preencha isso. `targetId` da decisão é `string` solta (`decision.ts:77`, `133`), apesar de `ids.ts` existir justamente para impedir trocar campanha com workspace.

### SQL injection

Não há SQL, query builder nem string concatenada de consulta. Nada a explorar.

### XSS

Não há HTML, template nem UI. `reason`, `detail` e `evidence.summary` são texto livre armazenado e devolvido. Quando houver painel, esse texto é entrada não confiável. `SECURITY.md:23-26` já trata nome de campanha como hostil para prompt; o mesmo vale para HTML.

### SSRF

Não há cliente HTTP, DNS nem URL buscada pelo servidor.

### Upload e path traversal

Não há upload, `fs` nem caminho de arquivo no fonte de `packages/`.

### Rate limit

Não há. O Sentinel tem `maxActionsPerDay` (`sentinel.ts:41-42`, `186-194`), que só funciona se o host registrar cada ação. Não é limite de rede.

### Segredos hardcoded

Nenhum no fonte, nos workflows ou nos docs. A CI não injeta secret. `.gitignore` prevê `.env`, e o exemplo que a exceção do gitignore espera não foi commitado.

### Outros

- O Sentinel compara `proposed.gt(current)` sem alinhar moeda (`sentinel.ts:134-138`). Reproduzido: BRL contra USD lança `CurrencyMismatchError` para fora de `evaluate`, em vez de um veredito `allowed: false`. Quem chamar sem `try` trata exceção como falha operacional, não como veto.
- A cota de capital divide `.minor` sem olhar moeda (`sentinel.ts:151-160`). Reproduzido: 500 BRL contra 1000 USD gera `CAPITAL_SHARE_TOO_HIGH` porque `500/1000 = 0.5`, não porque a moeda difere. Qualquer par cuja razão de centavos caiba em `maxCapitalShare` (0.3) passa.
- Modelo de ameaça de `SECURITY.md:27-31` (saída de modelo não vira ação; Sentinel não recebe texto) é verdade hoje por omissão: não há chamada de modelo. Também não há orquestrador que obrigue a ordem validação → Sentinel → Guard. Uma integração futura pode marcar `EXECUTED` (`decision.ts:109`) sem passar por nenhum dos dois.
- Dependências de produção dos pacotes: só `workspace:*`. O risco de supply chain está nas devDependencies (seção 6), não num runtime publicado.

---

## 5. TODO, FIXME, mock, temporário, placeholder

Busca em `*.ts`, `*.md`, `*.yml`, `*.json` por `TODO`, `FIXME`, `HACK`, `XXX`, `WIP`, `TEMP`, `placeholder`, `dummy`, `fake`, `temporary`, `hardcoded`, `mock`:

- Nenhuma marcação `TODO` / `FIXME` / `HACK`.
- A única ocorrência de "mock" é a negação em `packages/capital/src/memory-store.ts:4-8`: o store em memória é a referência, não um mock de teste.
- Não há flag `dry-run`, dado fake de campanha nem credencial de sandbox. O README descreve dry-run como plano do v0.5 (`README.md:133`), não como código.
- Números fixos que são política, não placeholder: `DEFAULT_POLICY` em `sentinel.ts:47-53` (180 min, 25% de passo, 60 min de cooldown, 24 ações/dia, 30% do capital). Estão nomeados e testados. Não são stub.
- `notFound` fixa a moeda `"BRL"` (`guard.ts:340-346`). Isso é comportamento hardcoded, não um comentário. Ver seção 3.
- IDs de teste `"ws-1"` aparecem só nos testes.

---

## 6. Testes

### Como rodar

Pré-requisito: Node 22+ e pnpm 9.15.9 (`package.json:5-8`, `CONTRIBUTING.md:4-8`). Não precisa de banco nem de chave.

```bash
pnpm install --frozen-lockfile
pnpm build       # tsc -b
pnpm typecheck   # tsc -b --force
pnpm lint        # alias de typecheck
pnpm test        # vitest run em packages/**
```

Os testes de capital, decision e sentinel importam `@forge/domain` pelo nome do pacote, que aponta para `dist/`. Sem `pnpm build` antes, eles falham do mesmo jeito que o CI do `b656d52`. Os testes de `domain` importam `../src` e não dependem do `dist`.

### Resultado desta sessão (2026-10-07)

Ambiente: Node v22.14.0, pnpm 9.15.9, TypeScript 5.9.3, Vitest 2.1.9 (resolvido pelo lock; `package.json` pede `typescript ^5.7.2` e `vitest ^2.1.8`).

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ok, 47 pacotes |
| `pnpm build` | ok |
| `pnpm typecheck` | ok |
| `pnpm lint` | ok (é o typecheck de novo) |
| `pnpm -r --filter './packages/**' typecheck` (`tsc -p --noEmit` por pacote) | ok, depois do build |
| `pnpm test` | ok. domain 15, capital 18, decision 12, sentinel 13. 4 arquivos, 58 testes |
| `pnpm audit --audit-level high` | **exit 1**. 10 avisos: 3 critical, 2 high, 5 moderate |

Os critical/high estão todos na cadeia de desenvolvimento do Vitest 2.1.9, não numa dependência de runtime:

- Vitest `<3.2.6`, GHSA-5xrq-8626-4rwp (UI do Vitest lê/executa arquivo)
- `tinypool` via Vitest, GHSA-5gmw-xhrv-c9v3 e GHSA-85c8-ppgw-ccpr
- `vite@5.4.21` via Vitest, GHSA-fx2h-pf6j-xcff (bypass de `server.fs.deny` no Windows; este CI é Linux e o projeto não sobe servidor Vite)
- `source-map-js` via PostCSS/Vite, GHSA-68fv-2mgg-jv7q

A CI não fica vermelha com isso (`ci.yml:43-45`). Subir para Vitest 4, que seria o caminho do Dependabot [#7](https://github.com/aislamsilvalol-ctrl/forge/pull/7), quebra o `vitest run` com `ERR_PACKAGE_PATH_NOT_EXPORTED`. O bump para 3.2.6 ([#5](https://github.com/aislamsilvalol-ctrl/forge/pull/5)) foi fechado sem entrar em `main`. Não rodei esses PRs de novo aqui.

O que a suíte **não** cobre, e que esta auditoria executou à parte:

- retry de `reserve` devolve o mesmo id
- commit de uma reserva e release da outra nascidas do mesmo retry
- mesma chave usada em `authorize` e em `reserve`
- `fromMajor(1.005)`
- `confidence` `NaN`
- `pendingBufferRatio` negativo
- moedas diferentes dentro do Sentinel

---

## 7. UX e mobile

Não há interface. `README.md:122-123` diz que nem o dashboard nem a integração embutida existem. Não há viewport, componente, rota nem estado de cliente para quebrar.

O que o código já deixa pronto, e que uma UI futura herdaria:

- Textos de erro e de veto estão em português (`money.ts`, `guard.ts`, `sentinel.ts`, `decision.ts`). Uma UI em outro idioma não tem catálogo de códigos estável para `detail`; o código estável é `DenialReason` / `SentinelCode`. `CURRENCY_MISMATCH` nunca é emitido (seção 3), então a UI não pode depender dele hoje.
- `notFound` preenche a posição com zeros em BRL (`guard.ts:332-348`). Um painel mostraria "R$ 0,00 disponível" para uma reserva inexistente, em qualquer moeda.
- `toString` / `toMajor` (`money.ts:117-124`) são a borda de exibição. Usar `toMajor()` para somar na UI reintroduz float. O JSON certo é `toJSON()` (`minor` + `currency`), testado em `money.test.ts:103-108`.
- Não há estado vazio, loading, erro de rede nem layout responsivo, porque não há tela. Nada de mobile para verificar no browser.

---

## 8. BACKLOG

Tamanho é em difusão no código, não em prazo. Pequeno: um pacote e a suíte dele. Médio: dois pacotes ou um contrato novo entre stores. Grande: persistência, conector ou superfície web.

### P0

**P0-1. Retry de `reserve` abre uma segunda reserva e o teto deixa de valer**

- Evidência: `packages/capital/src/guard.ts:216-238`; piso ausente em `packages/capital/src/ledger.ts:103-112` contra o piso de `committed` em `114-122`; teste que não vê o id em `packages/capital/test/guard.test.ts:115-125`.
- Risco: com a mesma chave, commit de um id e release do outro zeram `exposure` e devolvem o envelope inteiro enquanto `committed` continua positivo. Reproduzido com buffer `0` (`reserve(100)` aceito) e com o default `0.1` (`reserve(97)` aceito) sobre R$ 30 já comprometidos num envelope de R$ 100. A mesma chave usada antes em `authorize` (`ledger.ts:181-186`) cria reserva órfã com `reserved = 0`.
- Abordagem: no `reserve`, gravar `reservationId` na entrada **antes** de tratar a chamada como sucesso; no retry, devolver essa reserva e não criar outra; se a entrada já existente tiver outro `kind` ou outro valor, negar. Não mudar `derivePosition` neste conserto.
- Tamanho: pequeno. Spec na seção 9.

### P1

**P1-1. `reserved` negativo abate exposição**

- Evidência: `ledger.ts:103-112` e `127`; ADR `docs/adr/0003-posicao-derivada-do-extrato.md:21-24` explica o piso só de `committed`.
- Risco: qualquer `RELEASE`/`COMMIT` sem `RESERVE` correspondente (bug de idempotência, store parcial, chamada direta a `append`) esconde dinheiro que já saiu. O P0-1 deixa de ser explorável pelo retry, mas o fórmula continua furada.
- Abordagem: depois do P0-1, piso em `reserved` no mesmo espírito do `committed`, com teste que parte de um extrato inconsistente de propósito e exige `exposure >= spent + committed`. Não fazer isso no mesmo diff do P0, para o teste de regressão do retry continuar apontando a causa.
- Tamanho: pequeno.

**P1-2. `fromMajor` perde centavo em decimal binário sujo**

- Evidência: `packages/domain/src/money.ts:51-56`. Reproduzido: `1.005` BRL vira 100 centavos, não 101.
- Risco: entrada de envelope, fatura ou orçamento na borda autoriza ou reconcilia 1 centavo a menos, repetido por linha.
- Abordagem: converter a parte decimal por string (`"1.005"` → centavos) ou por inteiro de escala, e rejeitar mais de 2 casas em vez de arredondar float. Manter `fromMinor` como caminho interno. Acrescentar o caso `1.005` ao `money.test.ts` sem alterar os casos que já passam.
- Tamanho: pequeno.

**P1-3. `recordSpend` e `revoke` não exigem chave**

- Evidência: `guard.ts:127-136` e `320-329`; `ledger.ts:181-187` só deduplica se a chave vier.
- Risco: retry de webhook futuro dobra `spent` (falha fechada, reconciliação mentida) ou dobra `revoke` (teto encolhe duas vezes). `reservationId` não liquida a reserva.
- Abordagem: exigir chave em `recordSpend` e `revoke`; se a chave existir com outro valor ou outro `kind`, falhar; não abater `committed` de outra reserva. Continua sem webhook até existir conector.
- Tamanho: pequeno no Guard; médio quando o conector existir.

**P1-4. Sentinel erra moeda e pode lançar em vez de vetar**

- Evidência: `sentinel.ts:134-148` e `151-160`.
- Risco: BRL×USD em `proposed.gt(current)` explode com `CurrencyMismatchError`. A cota usa a razão dos centavos e ignora a moeda.
- Abordagem: se a moeda divergir, violação explícita (código novo, ao lado dos existentes) e seguir coletando as outras violações, como o teste `sentinel.test.ts:158-178` já exige. Não capturar a exceção com `catch` vazio.
- Tamanho: pequeno.

**P1-5. `pendingBufferRatio` negativo alarga o envelope**

- Evidência: `guard.ts:89-110` e `158-164`. Reproduzido: ratio `-1`, commit de 50 num envelope de 100, `spendableNow` devolve 100 e `reserve(100)` passa.
- Risco: opção de construtor desfaz a regra número um.
- Abordagem: rejeitar ratio fora de `[0, 1]` no construtor. Default `0.1` permanece.
- Tamanho: pequeno. Pode ir no mesmo PR do P0-1 se o diff continuar só em `guard.ts` e no teste; se crescer, separar.

**P1-6. CI ignora audit high, e o Vitest 2.1.9 tem avisos critical**

- Evidência: `ci.yml:43-45`; `pnpm audit` local exit 1; PR #7 vermelho no Vitest 4; PR #5 fechado no 3.2.6.
- Risco: o runtime dos pacotes não depende disso (não há servidor Vitest UI no `pnpm test`). O risco é quem rodar `vitest --ui`, e o controle de CI que finge auditar. Não é bypass de capital.
- Abordagem: subir Vitest para uma linha que feche os GHSA **e** passe `pnpm test` (3.2.x é o candidato que o próprio advisory cita; confirmar na prática, porque 4.1.11 já quebrou). Tirar `continue-on-error` só depois que o audit estiver limpo, senão `main` fica vermelho sem correção.
- Tamanho: pequeno, mas o bump precisa de um CI verde de verdade. Não misturar com o P0 de capital.

### P2

**P2-1. Chave de idempotência não carrega `kind` nem valor**

- Evidência: `ledger.ts:181-186`, `memory-store.ts:21-23`.
- Risco: o P0 cobre o sintoma no `reserve`. `authorize` com a mesma chave e outro valor devolve o primeiro em silêncio (`guard.test.ts:127-133` só testa o mesmo valor).
- Abordagem: no `append`, se a chave existir e `kind`/valor/moeda divergirem, lançar erro de conflito em vez de devolver a entrada. Store continua a implementação de referência.
- Tamanho: pequeno.

**P2-2. Decisão substitui o registro e aceita `NaN`**

- Evidência: `decision.ts:163-165`, `192-212`, `267-271`. `NaN` reproduzido como confiança aceita.
- Risco: duas transições concorrentes perdem uma; confiança `NaN` entra no histórico que um aprendizado futuro leria. Não move dinheiro hoje, porque ninguém liga a decisão ao Guard.
- Abordagem: rejeitar confiança não finita; mutex por id no `transition`/`observe`; o save continua substituindo o snapshot, desde que a cópia de `transitions` seja a única escrita.
- Tamanho: pequeno.

**P2-3. `notFound` mente a moeda; `CURRENCY_MISMATCH` é código morto**

- Evidência: `guard.ts:34-40` e `332-348`.
- Risco: cliente trata "sem posição BRL" como verdade contábil.
- Abordagem: posição ausente sem moeda inventada, ou moeda obrigatória no método. Emitir `CURRENCY_MISMATCH` só quando houver duas moedas reais na mesma operação. Não reutilizar o código para outra coisa.
- Tamanho: pequeno.

**P2-4. Mutex e stores não sobrevivem a dois processos**

- Evidência: `guard.ts:66-87`; stores em `memory-store.ts`.
- Risco: zero enquanto todo mundo usa um processo e a memória. Vira P0 no dia em que existir Oracle ou mais de um worker, se a API do `Mutex` continuar opcional e por instância.
- Abordagem: quando a persistência entrar, a trava e a unicidade da chave moram no store (constraint), não num `Map` local. Até lá, não simular Oracle.
- Tamanho: grande, e só junto da persistência. Não antecipar.

**P2-5. README e workspace descrevem pacotes que não existem**

- Evidência: `README.md:65` (`@forge/core`), `README.md:86` (testes de domain como "—"), `pnpm-workspace.yaml:3-4`.
- Risco: o próximo host importa um nome que não builda; a tabela de testes esconde os 15 testes que protegem `Money`.
- Abordagem: corrigir os nomes para os quatro pacotes reais, colocar 15 na coluna de domain, e tirar `connectors/*` e `apps/*` do workspace até os diretórios existirem. Sem criar os diretórios vazios.
- Tamanho: pequeno.

**P2-6. Actions da CI ainda são a geração que avisa Node 20**

- Evidência: `ci.yml:19-28`; PRs #8, #9 e #10 verdes e abertos; aviso no log do run `33646588646`.
- Risco: não quebra o build hoje. O runner já força Node 24 por baixo da action.
- Abordagem: merge dos PRs de Actions que já passaram na CI, um por vez, sem misturar com o bump de Vitest.
- Tamanho: pequeno.

**P2-7. `@forge/sentinel` depende de `@forge/capital` sem importar**

- Evidência: `packages/sentinel/package.json:21-24`, `packages/sentinel/tsconfig.json:11-17`, `sentinel.ts:14`.
- Risco: build ordena capital antes do sentinel sem necessidade; um publish puxaria capital para quem só quer o veto.
- Abordagem: remover a dependência e a reference se o próximo PR não for usar o Guard dentro do Sentinel. Se a intenção é o Sentinel consultar `spendableNow`, aí a dependência fica e o import tem de existir, com teste. Não deixar os dois estados ao mesmo tempo.
- Tamanho: pequeno.

### P3

**P3-1. Sem teste de `ids.ts`.** `packages/domain/src/ids.ts` rejeita só string vazia (linha 26). Relógio e geradores não têm teste. Tamanho pequeno.

**P3-2. `lint` não olha estilo nem `any`.** `package.json:13` e `CONTRIBUTING.md:25-26` pedem disciplina que o `tsc` não cobre por completo (`any` explícito o strict pega; `catch` vazio e comentário de `@ts-ignore`, não). Tamanho pequeno no dia em que o time quiser ESLint. Não adicionar antes de ter regra que falhe por um motivo que já aconteceu.

**P3-3. `.gitignore` ignora `.env.example` na exceção e duplica `*.tsbuildinfo`.** Linhas 4-10. Não há exemplo. Tamanho trivial. Sem segredo para documentar, o exemplo pode esperar o primeiro `process.env` real.

**P3-4. PRs de Dependabot acumulados (#4, #7, #8, #9, #10).** Higiene. O #7 não deve ser mergeado no estado atual (quebra o test). Tamanho pequeno, decisão por PR.

**P3-5. Telemetria.** Não há logger. Quando houver execução de verdade, o `detail` do veto precisa ir para um log estruturado sem incluir criativo de anúncio cru (`SECURITY.md:23-26`). Não construir agora. Tamanho médio, atrasado de propósito.

Itens que **não** entram no backlog como trabalho: reescrever o monorepo, trocar pnpm por Turborepo (ADR 0001 diz para esperar a build passar de ~2 min ou 15 pacotes), criar o conector Meta, a Oracle ou o dashboard dentro de um "aproveita que está auditando". O README já os coloca em v0.2+.

---

## 9. Primeira tarefa

A primeira tarefa é o P0-1. É cirúrgica, cabe em um pacote, e o teste que existe hoje passa sem impedir o furo.

### TASK

Fazer o retry de `CapitalGuard.reserve` devolver a mesma reserva, e fazer uma chave já usada por outro movimento não criar reserva órfã.

### CONTEXT

`reserve` é o único lugar que separa capital antes da execução (`guard.ts:166-170`). A chave de idempotência impede uma segunda linha `RESERVE` (`ledger.ts:165-187`), e o teste `guard.test.ts:115-125` trava isso. A reserva em si é criada depois do `append`, sem gravar o id na entrada (`guard.ts:216-238`). O retry acha a linha, não acha a reserva, e salva outra com id novo, estado `OPEN`. Commit de uma e release da outra são ambos aceitos. `derivePosition` soma `reserved + committed + spent` (`ledger.ts:127`) e o `reserved` negativo cancela o `committed`, então `available` volta ao autorizado.

A mesma função também trata como sucesso uma chave que já pertence a um `AUTHORIZE`: `append` devolve essa entrada, `reservationId` vem vazio, e o método cria uma reserva sem linha `RESERVE`.

Não há dado persistido em produção. O store de referência é memória. Dá para corrigir o contrato sem migração.

### FILES

- `packages/capital/src/guard.ts` — `reserve`, e o tipo `DenialReason` se entrar um motivo novo.
- `packages/capital/test/guard.test.ts` — estender o `describe("idempotência")`.
- `packages/capital/src/ledger.ts` — só se `append` precisar aceitar `reservationId` que ele **já** aceita em `AppendOptions` (`140-144` e `195`). Não mudar `derivePosition`.

Não abrir arquivo de decision, sentinel, domain, CI ou README neste PR.

### CURRENT BEHAVIOR

Dado um workspace com R$ 100 autorizados:

1. `reserve(30, key)` e `reserve(30, key)` devolvem `allowed: true` com ids diferentes. O extrato tem uma `RESERVE` de 30. O store tem duas reservas `OPEN`.
2. `commit` do segundo id e `release` do primeiro são ambos `allowed: true`.
3. A posição fica `reserved = -30`, `committed = 30`, `exposure = 0`, `available = 100`.
4. Uma reserva nova de 100 (buffer 0) ou de 97 (buffer default 0.1) é aceita.
5. `authorize(100, "same-key")` seguido de `reserve(40, "same-key")` devolve `allowed: true`, `reserved = 0`, extrato só com `AUTHORIZE`, e uma reserva `OPEN` que não tem lastro.

O teste atual passa nos dois casos, porque ele não lê o id nem tenta commit/release cruzado.

### REQUIRED BEHAVIOR

1. Duas chamadas `reserve` com a mesma chave, o mesmo workspace, o mesmo valor e a mesma moeda devolvem `allowed: true` e o **mesmo** `Reservation.id`. O store contém uma reserva. `reserved` permanece o valor de uma reserva só.
2. A entrada `RESERVE` dessa chave carrega o `reservationId` da reserva devolvida.
3. Se a primeira chamada gravou a linha e não chegou a salvar a reserva, o retry recria a reserva com o id que já está na linha. Não gera outro id.
4. Se a chave já existe em entrada cujo `kind` não é `RESERVE`, ou cujo valor ou moeda diferem, `reserve` devolve `allowed: false` e não salva reserva nova. O extrato não ganha linha. Motivo novo e explícito, sem reaproveitar `CURRENCY_MISMATCH` para esse caso.
5. Commit e release seguem iguais para uma única reserva: o segundo commit é `RESERVATION_ALREADY_SETTLED`; release depois de commit também. Não deve existir um segundo id para operar.
6. Os 18 testes atuais de `guard.test.ts` continuam passando, inclusive concorrência, colchão e gasto acima do commit.

### DO NOT BREAK

- Não recalcular `available` de outro jeito. Não colocar piso em `reserved` neste PR (isso é o P1-1).
- Não exigir chave de idempotência onde hoje ela é opcional. Chamada sem chave continua podendo reservar, desde que caiba no teto.
- Não mudar `authorize`, `revoke`, `recordSpend`, `commit` ou `release` além do que for estritamente necessário para o `reserve` enxergar a reserva já gravada.
- Não introduzir banco, fila, HTTP ou conector.
- Não alterar a assinatura de sucesso: `{ allowed: true, value: Reservation }` permanece.
- Não enfraquecer o mutex nem o teste das dez reservas concorrentes (`guard.test.ts:100-113`).
- Não mexer em `@forge/decision` nem em `@forge/sentinel`.

### IMPLEMENTATION

1. Em `reserve`, gerar o id da reserva **antes** do `append` e passá-lo em `AppendOptions.reservationId` junto com a chave. `append` já copia esse campo quando a chave é nova (`ledger.ts:188-200`).
2. Quando `append` devolver entrada já existente:
   - se `kind !== "RESERVE"` ou o valor/moeda não for igual ao pedido, retornar `allowed: false` com motivo de conflito de idempotência e a posição atual. Não chamar `reservations.save`.
   - se for a mesma reserva e `entry.reservationId` existir, carregar essa reserva e devolvê-la.
   - se o id estiver na entrada e o store não tiver a reserva, salvar uma reserva `OPEN` com **esse** id, o valor da entrada e o workspace da entrada.
3. Não usar o id gerado nesta tentativa quando a entrada devolvida for a antiga.
4. Manter o corpo inteiro dentro do `mutex.runExclusive` que já existe (`guard.ts:177`).
5. Não alterar `derivePosition`.

### TESTS

Acrescentar em `packages/capital/test/guard.test.ts`, no bloco de idempotência, sem apagar os testes atuais:

1. Retry com a mesma chave: `first.value.id === retry.value.id`, uma reserva no store, `reserved` igual a 30.
2. O cenário reproduzido: commit do id devolvido, release do mesmo id negado, `committed` igual ao reservado, `available` igual ao autorizado menos esse valor. Uma segunda reserva do restante cabe; uma reserva do autorizado inteiro não cabe.
3. Chave já usada em `authorize`: `reserve` com essa chave é `allowed: false`, store de reservas vazio, `reserved` zero.
4. Mesma chave e valor diferente (30 e depois 40): a segunda é `allowed: false`, `reserved` continua 30, uma reserva só.

Rodar `pnpm test` e `pnpm typecheck` a partir da raiz, depois de `pnpm build` se o `dist` não estiver fresco.

### ACCEPTANCE CRITERIA

- `pnpm test` verde, com os 58 testes anteriores e os novos.
- `pnpm typecheck` verde.
- Não existe mais um par de ids `OPEN` produzido por uma única chave.
- O cenário "commit de um id do retry e release do outro" não é mais construível pela API de `reserve`.
- `derivePosition` e os testes de gasto acima do commit (`guard.test.ts:211-224`) permanecem intactos.
- Diff limitado a `packages/capital/src/guard.ts`, `packages/capital/test/guard.test.ts` e, no máximo, um ajuste mínimo em `ledger.ts` se o tipo de opção precisar de um campo que já existe. Nenhum outro pacote.
