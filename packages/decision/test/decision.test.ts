/**
 * O extrato de decisões precisa ser reescrita-resistente: o passado não muda,
 * e nenhuma proposta vira execução pulando etapas.
 */
import { describe, expect, it } from "vitest";
import {
  FixedClock,
  Money,
  SequentialIdGenerator,
  WorkspaceId,
} from "@forge/domain";
import {
  DecisionLedger,
  InMemoryDecisionStore,
  InvalidTransitionError,
  canTransition,
  outcomeWithinExpectation,
  type ProposeInput,
} from "../src/index.js";

const WS = WorkspaceId("ws-1");
const NOW = new Date("2026-09-02T12:00:00Z");

function setup() {
  const clock = new FixedClock(NOW);
  const store = new InMemoryDecisionStore();
  return {
    ledger: new DecisionLedger(store, clock, new SequentialIdGenerator("dec")),
    clock,
    store,
  };
}

const input = (over: Partial<ProposeInput> = {}): ProposeInput => ({
  workspaceId: WS,
  targetType: "CAMPAIGN",
  targetId: "c-17",
  action: "INCREASE_BUDGET",
  reason: "campanha absorve escala sem degradar o custo por aquisição",
  evidence: [
    {
      kind: "cac_stability",
      summary: "CAC estável em 7 dias com volume crescente",
      value: 31.84,
      sampleSize: 214,
      source: "meta.insights",
    },
  ],
  expected: { metric: "cac_brl", expectedMin: 29, expectedMax: 35 },
  confidence: 0.73,
  capitalAtRisk: Money.fromMajor(150, "BRL"),
  risk: "MEDIUM",
  guardrails: [
    {
      description: "CAC não pode passar de R$40 na janela de 48h",
      rollbackWhen: "cac_brl > 40",
    },
  ],
  ...over,
});

describe("proposta", () => {
  it("exige evidência — palpite não move dinheiro", async () => {
    const { ledger } = setup();
    await expect(ledger.propose(input({ evidence: [] }))).rejects.toThrow(
      /evidência/i,
    );
  });

  it("rejeita confiança fora de 0..1", async () => {
    const { ledger } = setup();
    await expect(ledger.propose(input({ confidence: 1.4 }))).rejects.toThrow(
      /Confiança/,
    );
  });

  it("rejeita faixa esperada invertida", async () => {
    const { ledger } = setup();
    await expect(
      ledger.propose(
        input({ expected: { metric: "cac", expectedMin: 50, expectedMax: 10 } }),
      ),
    ).rejects.toThrow(/invertida/);
  });

  it("nasce como PROPOSED, nunca executada direto", async () => {
    const { ledger } = setup();
    const d = await ledger.propose(input());
    expect(d.status).toBe("PROPOSED");
    expect(d.transitions).toHaveLength(0);
  });
});

describe("máquina de estados", () => {
  it("proposta não pula direto para executada", async () => {
    const { ledger } = setup();
    const d = await ledger.propose(input());
    await expect(
      ledger.transition(d.id, "EXECUTED", "engine", "atalho"),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("rejeitada é estado terminal", async () => {
    const { ledger } = setup();
    const d = await ledger.propose(input());
    await ledger.transition(d.id, "REJECTED", "sentinel", "dado velho");
    await expect(
      ledger.transition(d.id, "APPROVED", "engine", "tentando de novo"),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("caminho completo preserva cada transição", async () => {
    const { ledger, clock } = setup();
    const d = await ledger.propose(input());
    await ledger.transition(d.id, "APPROVED", "operador", "aprovado no painel");
    clock.advance(60_000);
    await ledger.transition(d.id, "EXECUTED", "engine", "orçamento aplicado");
    clock.advance(48 * 3600_000);
    const observed = await ledger.observe(d.id, "cac_brl", 31.84, "engine");

    expect(observed.status).toBe("OBSERVED");
    expect(observed.transitions.map((t) => t.to)).toEqual([
      "APPROVED",
      "EXECUTED",
      "OBSERVED",
    ]);
    // o histórico guarda quem fez e quando — nada é sobrescrito
    expect(observed.transitions[0]?.by).toBe("operador");
    expect(observed.transitions[2]?.at.getTime()).toBeGreaterThan(
      observed.transitions[0]!.at.getTime(),
    );
  });

  it("executada pode ser revertida, e reversão é terminal", async () => {
    const { ledger } = setup();
    const d = await ledger.propose(input());
    await ledger.transition(d.id, "APPROVED", "operador", "ok");
    await ledger.transition(d.id, "EXECUTED", "engine", "aplicado");
    const back = await ledger.transition(
      d.id,
      "ROLLED_BACK",
      "sentinel",
      "guardrail violado: CAC 44",
    );
    expect(back.status).toBe("ROLLED_BACK");
    await expect(
      ledger.transition(d.id, "OBSERVED", "engine", "tarde demais"),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("tabela de transições nega saltos inválidos", () => {
    expect(canTransition("PROPOSED", "APPROVED")).toBe(true);
    expect(canTransition("PROPOSED", "OBSERVED")).toBe(false);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
    expect(canTransition("ROLLED_BACK", "EXECUTED")).toBe(false);
  });
});

describe("avaliação do resultado", () => {
  it("acerto dentro da faixa prevista conta como calibrado", async () => {
    const { ledger } = setup();
    const d = await ledger.propose(input());
    await ledger.transition(d.id, "APPROVED", "op", "ok");
    await ledger.transition(d.id, "EXECUTED", "engine", "aplicado");
    const obs = await ledger.observe(d.id, "cac_brl", 31.84, "engine");
    expect(outcomeWithinExpectation(obs)).toBe(true);
  });

  it("resultado fora da faixa é registrado como erro de calibração", async () => {
    const { ledger } = setup();
    const d = await ledger.propose(input());
    await ledger.transition(d.id, "APPROVED", "op", "ok");
    await ledger.transition(d.id, "EXECUTED", "engine", "aplicado");
    const obs = await ledger.observe(d.id, "cac_brl", 52.1, "engine");
    expect(outcomeWithinExpectation(obs)).toBe(false);
  });

  it("sem observação não há veredito — nulo, não falso", async () => {
    const { ledger } = setup();
    const d = await ledger.propose(input());
    expect(outcomeWithinExpectation(d)).toBeNull();
  });
});
