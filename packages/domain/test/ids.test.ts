/**
 * IDs, relógio e geradores. A marca some em runtime; o que fica é a recusa
 * de id vazio e o tempo injetável.
 */
import { describe, expect, it } from "vitest";
import {
  AdId,
  AdSetId,
  CampaignId,
  CapitalEntryId,
  CreativeId,
  DecisionId,
  ExperimentId,
  FixedClock,
  ReservationId,
  SequentialIdGenerator,
  WorkspaceId,
  randomIdGenerator,
  systemClock,
} from "../src/index.js";

const constructors = {
  WorkspaceId,
  CampaignId,
  AdSetId,
  AdId,
  CreativeId,
  DecisionId,
  ExperimentId,
  CapitalEntryId,
  ReservationId,
} as const;

describe("IDs", () => {
  it("rejeita string vazia em todos os construtores", () => {
    for (const make of Object.values(constructors)) {
      expect(() => make("")).toThrow(/ID não pode ser vazio/);
    }
  });

  it("em runtime o id é a string que entrou", () => {
    expect(WorkspaceId("ws-1")).toBe("ws-1");
    expect(CampaignId("c-17")).toBe("c-17");
    expect(ReservationId("res-1")).toBe("res-1");
    expect(DecisionId("dec-1")).toBe("dec-1");
  });
});

describe("relógio", () => {
  it("FixedClock devolve, avança e substitui o instante", () => {
    const clock = new FixedClock(new Date("2026-09-02T12:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-09-02T12:00:00.000Z");
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe("2026-09-02T12:01:00.000Z");
    clock.set(new Date("2026-01-01T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("systemClock devolve um Date próximo de agora", () => {
    const before = Date.now();
    const now = systemClock.now();
    const after = Date.now();
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("geradores", () => {
  it("SequentialIdGenerator conta a partir de 1 e respeita o prefixo", () => {
    const ids = new SequentialIdGenerator("dec");
    expect(ids.next()).toBe("dec-1");
    expect(ids.next()).toBe("dec-2");

    const other = new SequentialIdGenerator();
    expect(other.next()).toBe("id-1");
    expect(ids.next()).toBe("dec-3");
  });

  it("randomIdGenerator devolve UUIDs diferentes", () => {
    const a = randomIdGenerator.next();
    const b = randomIdGenerator.next();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(b).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(a).not.toBe(b);
  });
});
