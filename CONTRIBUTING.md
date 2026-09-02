# Contributing

## Getting started

```bash
pnpm install
pnpm test
pnpm typecheck
```

Node 22+, pnpm 9+. No database or API key is needed to run the test suite —
if a change makes that untrue, that is a design problem worth discussing
first.

## Ground rules

**Complexity has to buy something.** Reliability, security, scale,
maintainability, observability or product value. If the honest answer to
"why does this exist?" is "because it looks modern", it does not get merged.

**Comments explain *why*, not *what*.** `// increment counter` adds nothing.
`// committed never goes negative: it would understate real exposure` is the
reason the next person does not "simplify" a safety property away.

**No `any`, no blank `catch`, no `@ts-ignore` without a written reason.**
`tsconfig` is strict on purpose.

**Financial code needs tests first.** Changes to `@forge/capital`,
`@forge/decision` or `@forge/sentinel` require tests that fail before the fix
and pass after. These packages carry the invariants that protect real money.

## Commits

Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
`chore:`. The subject line says what changed; the body says why.

## Pull requests

CI must be green — typecheck, tests and build. A PR touching capital or
safety logic should say in the description which invariant it preserves.
