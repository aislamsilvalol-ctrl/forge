/**
 * O Sentinel é código, não conselho: estes testes garantem que ele bloqueia
 * mesmo quando tudo o mais diz "pode".
 */
import { describe, expect, it } from "vitest";
import { FixedClock, Money, WorkspaceId } from "@forge/domain";
import {
  DEFAULT_POLICY,
  InMemoryActionHistory,
  Sentinel,
  type ActionContext,
  type SentinelState,
} from "../src/index.js";

const WS = WorkspaceId("ws-1");
const brl = (v: number) => Money.fromMajor(v, "BRL");
const NOW = new Date("2026-09-02T12:00:00Z");
const OPEN: SentinelState = { killSwitch: false, safeMode: false };

function ctx(over: Partial<ActionContext> = {}): ActionContext {
  return {
    workspaceId: WS,
    targetId: "campaign-1",
    dataObservedAt: new Date(NOW.getTime() - 5 * 60_000),
    currentValue: brl(100),
    proposedValue: brl(110),
    capitalAtRisk: brl(110),
    authorizedCapital: brl(1000),
    fingerprint: "inc-campaign-1-110",
    ...over,
  };
}

function setup(history = new InMemoryActionHistory()) {
  return {
    sentinel: new Sentinel(new FixedClock(NOW), history, DEFAULT_POLICY),
    history,
  };
}

describe("kill switch e modo seguro", () => {
  it("kill switch bloqueia qualquer mutação", async () => {
    const { sentinel } = setup();
    const v = await sentinel.evaluate(ctx(), {
      killSwitch: true,
      safeMode: false,
    });
    expect(v.allowed).toBe(false);
    expect(v.violations.map((x) => x.code)).toContain("KILL_SWITCH");
  });

  it("modo seguro bloqueia mesmo com ação pequena e dados frescos", async () => {
    const { sentinel } = setup();
    const v = await sentinel.evaluate(ctx({ proposedValue: brl(101) }), {
      killSwitch: false,
      safeMode: true,
    });
    expect(v.allowed).toBe(false);
    expect(v.violations.map((x) => x.code)).toContain("SAFE_MODE");
  });
});

describe("qualidade do dado", () => {
  it("bloqueia decisão apoiada em métrica velha", async () => {
    const { sentinel } = setup();
    const v = await sentinel.evaluate(
      ctx({ dataObservedAt: new Date(NOW.getTime() - 5 * 60 * 60_000) }),
      OPEN,
    );
    expect(v.allowed).toBe(false);
    const stale = v.violations.find((x) => x.code === "STALE_DATA");
    expect(stale?.detail).toContain("300 min");
  });

  it("dado recente passa", async () => {
    const { sentinel } = setup();
    const v = await sentinel.evaluate(ctx(), OPEN);
    expect(v.allowed).toBe(true);
  });
});

describe("escalonamento gradual", () => {
  it("bloqueia salto acima do passo máximo", async () => {
    const { sentinel } = setup();
    // 100 → 400 é +300%
    const v = await sentinel.evaluate(
      ctx({ proposedValue: brl(400), capitalAtRisk: brl(400) }),
      OPEN,
    );
    expect(v.allowed).toBe(false);
    expect(v.violations.map((x) => x.code)).toContain("STEP_TOO_LARGE");
  });

  it("permite aumento dentro do passo", async () => {
    const { sentinel } = setup();
    const v = await sentinel.evaluate(ctx({ proposedValue: brl(120) }), OPEN);
    expect(v.allowed).toBe(true);
  });

  it("redução nunca é bloqueada por tamanho de passo", async () => {
    const { sentinel } = setup();
    const v = await sentinel.evaluate(
      ctx({ proposedValue: brl(10), capitalAtRisk: brl(10) }),
      OPEN,
    );
    expect(v.violations.map((x) => x.code)).not.toContain("STEP_TOO_LARGE");
  });
});

describe("concentração de capital", () => {
  it("bloqueia ação que move fatia grande demais do autorizado", async () => {
    const { sentinel } = setup();
    const v = await sentinel.evaluate(
      ctx({ capitalAtRisk: brl(500), authorizedCapital: brl(1000) }),
      OPEN,
    );
    expect(v.allowed).toBe(false);
    expect(v.violations.map((x) => x.code)).toContain(
      "CAPITAL_SHARE_TOO_HIGH",
    );
  });
});

describe("resfriamento e duplicata", () => {
  it("bloqueia segunda ação no mesmo alvo dentro da janela", async () => {
    const history = new InMemoryActionHistory();
    history.record(WS, "campaign-1", "outra", new Date(NOW.getTime() - 600_000));
    const { sentinel } = setup(history);
    const v = await sentinel.evaluate(ctx(), OPEN);
    expect(v.allowed).toBe(false);
    expect(v.violations.map((x) => x.code)).toContain("COOLDOWN_ACTIVE");
  });

  it("bloqueia ação idêntica já executada", async () => {
    const history = new InMemoryActionHistory();
    history.record(
      WS,
      "outro-alvo",
      "inc-campaign-1-110",
      new Date(NOW.getTime() - 10 * 60 * 60_000),
    );
    const { sentinel } = setup(history);
    const v = await sentinel.evaluate(ctx(), OPEN);
    expect(v.violations.map((x) => x.code)).toContain("DUPLICATE_ACTION");
  });

  it("bloqueia cascata de ações no mesmo dia", async () => {
    const history = new InMemoryActionHistory();
    for (let i = 0; i < DEFAULT_POLICY.maxActionsPerDay; i++) {
      history.record(WS, `alvo-${i}`, `fp-${i}`, NOW);
    }
    const { sentinel } = setup(history);
    const v = await sentinel.evaluate(ctx(), OPEN);
    expect(v.violations.map((x) => x.code)).toContain("DAILY_ACTION_LIMIT");
  });
});

describe("veredito", () => {
  it("relata TODAS as violações, não só a primeira", async () => {
    const history = new InMemoryActionHistory();
    history.record(WS, "campaign-1", "x", new Date(NOW.getTime() - 60_000));
    const { sentinel } = setup(history);
    const v = await sentinel.evaluate(
      ctx({
        dataObservedAt: new Date(NOW.getTime() - 10 * 60 * 60_000),
        proposedValue: brl(900),
        capitalAtRisk: brl(900),
      }),
      { killSwitch: true, safeMode: false },
    );
    const codes = v.violations.map((x) => x.code);
    expect(codes).toContain("KILL_SWITCH");
    expect(codes).toContain("STALE_DATA");
    expect(codes).toContain("STEP_TOO_LARGE");
    expect(codes).toContain("CAPITAL_SHARE_TOO_HIGH");
    expect(codes).toContain("COOLDOWN_ACTIVE");
    expect(v.violations.length).toBeGreaterThanOrEqual(5);
  });

  it("toda violação explica o motivo em texto legível", async () => {
    const { sentinel } = setup();
    const v = await sentinel.evaluate(
      ctx({ dataObservedAt: new Date(NOW.getTime() - 10 * 60 * 60_000) }),
      OPEN,
    );
    for (const violation of v.violations) {
      expect(violation.detail.length).toBeGreaterThan(20);
    }
  });
});
