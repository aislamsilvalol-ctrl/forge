/**
 * Bateria obrigatória do Capital Guard (item 120 do spec).
 *
 * Estes testes são a especificação executável da regra número um do produto:
 * o motor nunca gasta além do autorizado. Qualquer implementação futura de
 * store (Oracle) precisa passar exatamente nesta bateria.
 */
import { describe, expect, it } from "vitest";
import {
  CapitalEntryId,
  FixedClock,
  Money,
  ReservationId,
  SequentialIdGenerator,
  WorkspaceId,
} from "@forge/domain";
import {
  CapitalGuard,
  CapitalLedger,
  IdempotencyConflictError,
  InMemoryCapitalLedgerStore,
  InMemoryReservationStore,
  derivePosition,
  type CapitalEntry,
} from "../src/index.js";

const WS = WorkspaceId("ws-1");
const brl = (major: number) => Money.fromMajor(major, "BRL");

function setup(bufferRatio = 0) {
  const clock = new FixedClock(new Date("2026-09-02T12:00:00Z"));
  const ledgerStore = new InMemoryCapitalLedgerStore();
  const reservations = new InMemoryReservationStore();
  const ledger = new CapitalLedger(
    ledgerStore,
    clock,
    new SequentialIdGenerator("entry"),
  );
  const guard = new CapitalGuard(
    ledger,
    reservations,
    clock,
    new SequentialIdGenerator("res"),
    undefined,
    { pendingBufferRatio: bufferRatio },
  );
  return { guard, ledger, ledgerStore, reservations, clock };
}

describe("não é possível ultrapassar o capital autorizado", () => {
  it("nega reserva acima do autorizado, com os números na justificativa", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(1000), "envelope inicial");

    const ok = await guard.reserve(WS, brl(600), "campanha A");
    expect(ok.allowed).toBe(true);

    const denied = await guard.reserve(WS, brl(500), "campanha B");
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error("deveria negar");
    expect(denied.reason).toBe("EXCEEDS_AUTHORIZED");
    expect(denied.detail).toContain("BRL 500.00");
    expect(denied.detail).toContain("BRL 400.00"); // disponível real
  });

  it("sem autorização nenhuma, nada é reservado", async () => {
    const { guard } = setup();
    const r = await guard.reserve(WS, brl(1), "primeira ação");
    expect(r.allowed).toBe(false);
    if (r.allowed) throw new Error("deveria negar");
    expect(r.reason).toBe("NO_AUTHORIZATION");
  });

  it("a soma de várias reservas respeita o teto", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    for (let i = 0; i < 10; i++) {
      const r = await guard.reserve(WS, brl(10), `ação ${i}`);
      expect(r.allowed).toBe(true);
    }
    const excedente = await guard.reserve(WS, brl(0.01), "um centavo a mais");
    expect(excedente.allowed).toBe(false);
  });
});

describe("concorrência", () => {
  it("duas reservas simultâneas não ultrapassam o teto (sem corrida)", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");

    // ambas leem "sobra 100" se não houver serialização
    const [a, b] = await Promise.all([
      guard.reserve(WS, brl(80), "worker 1"),
      guard.reserve(WS, brl(80), "worker 2"),
    ]);

    const permitidas = [a, b].filter((r) => r.allowed).length;
    expect(permitidas).toBe(1);
    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(80);
    expect(pos.available.toMajor()).toBe(20);
  });

  it("dez tentativas concorrentes param exatamente no teto", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(50), "envelope");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        guard.reserve(WS, brl(10), `worker ${i}`),
      ),
    );
    expect(results.filter((r) => r.allowed).length).toBe(5);
    const pos = await guard.position(WS, "BRL");
    expect(pos.available.toMajor()).toBe(0);
    expect(pos.reserved.toMajor()).toBe(50);
  });
});

describe("idempotência", () => {
  it("mesma chave não reserva duas vezes (retry de worker)", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const key = "decision-42";
    const first = await guard.reserve(WS, brl(30), "ação", key);
    const retry = await guard.reserve(WS, brl(30), "ação", key);
    expect(first.allowed && retry.allowed).toBe(true);
    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(30); // não 60
  });

  it("autorização repetida com a mesma chave não dobra o envelope", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(500), "envelope", "auth-1");
    await guard.authorize(WS, brl(500), "envelope", "auth-1");
    const pos = await guard.position(WS, "BRL");
    expect(pos.authorized.toMajor()).toBe(500);
  });

  it("retry com a mesma chave devolve a mesma reserva", async () => {
    const { guard, ledger, reservations } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const key = "decision-42";
    const first = await guard.reserve(WS, brl(30), "ação", key);
    const retry = await guard.reserve(WS, brl(30), "ação", key);
    expect(first.allowed).toBe(true);
    expect(retry.allowed).toBe(true);
    if (!first.allowed || !retry.allowed) throw new Error("deveria permitir");
    expect(retry.value.id).toBe(first.value.id);
    expect(reservations.all()).toHaveLength(1);

    const reserves = (await ledger.entries(WS)).filter(
      (e) => e.kind === "RESERVE",
    );
    expect(reserves).toHaveLength(1);
    expect(reserves[0]?.reservationId).toBe(first.value.id);
    expect(reserves[0]?.idempotencyKey).toBe(key);

    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(30);
  });

  it("retry devolve a mesma reserva mesmo quando ela já ocupou o envelope", async () => {
    const { guard, reservations } = setup();
    await guard.authorize(WS, brl(30), "envelope justo");
    const key = "decision-tight";
    const first = await guard.reserve(WS, brl(30), "ação", key);
    const retry = await guard.reserve(WS, brl(30), "ação", key);
    expect(first.allowed).toBe(true);
    expect(retry.allowed).toBe(true);
    if (!first.allowed || !retry.allowed) throw new Error("deveria permitir");
    expect(retry.value.id).toBe(first.value.id);
    expect(reservations.all()).toHaveLength(1);
    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(30);
    expect(pos.available.toMajor()).toBe(0);
  });

  it("commit e release da mesma reserva não devolvem o envelope", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const key = "decision-42";
    const first = await guard.reserve(WS, brl(30), "ação", key);
    const retry = await guard.reserve(WS, brl(30), "ação", key);
    if (!first.allowed || !retry.allowed) throw new Error("deveria permitir");
    expect(retry.value.id).toBe(first.value.id);

    const committed = await guard.commit(first.value.id, "executado");
    expect(committed.allowed).toBe(true);
    const released = await guard.release(
      retry.value.id,
      "tentativa de liberar o que já foi comprometido",
    );
    expect(released.allowed).toBe(false);
    if (released.allowed) throw new Error("deveria negar");
    expect(released.reason).toBe("RESERVATION_ALREADY_SETTLED");

    const pos = await guard.position(WS, "BRL");
    expect(pos.committed.toMajor()).toBe(30);
    expect(pos.reserved.toMajor()).toBe(0);
    expect(pos.available.toMajor()).toBe(70);
    expect(pos.exposure.toMajor()).toBe(30);

    // O comprometido continua no teto: o envelope inteiro não cabe, o resto cabe.
    const inteiro = await guard.reserve(WS, brl(100), "envelope inteiro");
    expect(inteiro.allowed).toBe(false);
    const resto = await guard.reserve(WS, brl(70), "resto");
    expect(resto.allowed).toBe(true);
  });

  it("chave já usada em authorize não cria reserva órfã", async () => {
    const { guard, ledger, reservations } = setup();
    await guard.authorize(WS, brl(100), "envelope", "same-key");
    const r = await guard.reserve(WS, brl(40), "ação", "same-key");
    expect(r.allowed).toBe(false);
    if (r.allowed) throw new Error("deveria negar");
    expect(r.reason).toBe("IDEMPOTENCY_CONFLICT");
    expect(r.position.authorized.toMajor()).toBe(100);
    expect(reservations.all()).toHaveLength(0);
    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(0);
    expect((await ledger.entries(WS)).map((e) => e.kind)).toEqual([
      "AUTHORIZE",
    ]);
  });

  it("mesma chave em outra moeda é conflito, não CURRENCY_MISMATCH", async () => {
    const { guard, reservations } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    await guard.authorize(WS, Money.fromMajor(100, "USD"), "envelope USD");
    const key = "decision-fx";
    const first = await guard.reserve(WS, brl(30), "ação", key);
    expect(first.allowed).toBe(true);

    const second = await guard.reserve(
      WS,
      Money.fromMajor(30, "USD"),
      "ação",
      key,
    );
    expect(second.allowed).toBe(false);
    if (second.allowed) throw new Error("deveria negar");
    expect(second.reason).toBe("IDEMPOTENCY_CONFLICT");
    expect(reservations.all()).toHaveLength(1);
    const pos = await guard.position(WS, "USD");
    expect(pos.reserved.toMajor()).toBe(0);
  });

  it("mesma chave com valor diferente é negada", async () => {
    const { guard, reservations } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const key = "decision-42";
    const first = await guard.reserve(WS, brl(30), "ação", key);
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error("primeira deveria passar");

    const second = await guard.reserve(WS, brl(40), "ação", key);
    expect(second.allowed).toBe(false);
    if (second.allowed) throw new Error("deveria negar");
    expect(second.reason).toBe("IDEMPOTENCY_CONFLICT");
    expect(reservations.all()).toHaveLength(1);
    expect(reservations.all()[0]?.id).toBe(first.value.id);
    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(30);
  });

  it("retry recria a reserva com o id já gravado na linha", async () => {
    const { guard, ledger, reservations } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const reservationId = ReservationId("res-orphan");
    await ledger.append(WS, "RESERVE", brl(30), "ação interrompida", {
      idempotencyKey: "key-orphan",
      reservationId,
    });

    const retry = await guard.reserve(WS, brl(30), "ação", "key-orphan");
    expect(retry.allowed).toBe(true);
    if (!retry.allowed) throw new Error("deveria permitir");
    expect(retry.value.id).toBe(reservationId);
    expect(retry.value.state).toBe("OPEN");
    expect(retry.value.amount.equals(brl(30))).toBe(true);
    expect(reservations.all()).toHaveLength(1);
    expect(
      (await ledger.entries(WS)).filter((e) => e.kind === "RESERVE"),
    ).toHaveLength(1);

    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(30);
  });

  it("retry de recordSpend e revoke com a mesma chave não grava outra linha", async () => {
    const { guard, ledger } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const reserved = await guard.reserve(WS, brl(40), "ação");
    if (!reserved.allowed) throw new Error("reserva deveria passar");
    await guard.commit(reserved.value.id, "executado");

    const firstSpend = await guard.recordSpend(WS, brl(37.5), "relato", {
      reservationId: reserved.value.id,
      idempotencyKey: "spend-1",
    });
    const retrySpend = await guard.recordSpend(WS, brl(37.5), "relato de novo", {
      idempotencyKey: "spend-1",
    });
    expect(retrySpend).toEqual(firstSpend);
    expect(retrySpend.spent.toMajor()).toBe(37.5);

    const firstRevoke = await guard.revoke(WS, brl(20), "reduz", "rev-1");
    const retryRevoke = await guard.revoke(WS, brl(20), "reduz de novo", "rev-1");
    expect(retryRevoke).toEqual(firstRevoke);
    expect(retryRevoke.authorized.toMajor()).toBe(80);

    const kinds = (await ledger.entries(WS)).map((e) => e.kind);
    expect(kinds).toEqual(["AUTHORIZE", "RESERVE", "COMMIT", "SPEND", "REVOKE"]);
  });

  it("chave de gasto ou revogação reusada em outro movimento ou valor é conflito e não grava", async () => {
    const { guard, ledger } = setup();
    await guard.authorize(WS, brl(100), "envelope", "auth-key");
    await expect(
      guard.recordSpend(WS, brl(10), "gasto com chave da autorização", {
        idempotencyKey: "auth-key",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(
      guard.revoke(WS, brl(10), "revogação com chave da autorização", "auth-key"),
    ).rejects.toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });

    await guard.recordSpend(WS, brl(10), "relato", { idempotencyKey: "spend-1" });
    await expect(
      guard.recordSpend(WS, brl(12), "outro valor", { idempotencyKey: "spend-1" }),
    ).rejects.toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });
    await expect(
      guard.revoke(WS, brl(10), "revoga com chave do gasto", "spend-1"),
    ).rejects.toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });

    await guard.revoke(WS, brl(15), "reduz", "rev-1");
    await expect(
      guard.revoke(WS, brl(16), "outro valor", "rev-1"),
    ).rejects.toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });
    await expect(
      guard.recordSpend(WS, Money.fromMajor(15, "USD"), "outra moeda", {
        idempotencyKey: "rev-1",
      }),
    ).rejects.toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });

    const entries = await ledger.entries(WS);
    expect(entries.map((e) => e.kind)).toEqual(["AUTHORIZE", "SPEND", "REVOKE"]);
    expect(entries.find((e) => e.kind === "SPEND")?.amount.toMajor()).toBe(10);
    expect(entries.find((e) => e.kind === "REVOKE")?.amount.toMajor()).toBe(15);
    const pos = await guard.position(WS, "BRL");
    expect(pos.authorized.toMajor()).toBe(85);
    expect(pos.spent.toMajor()).toBe(10);
  });
});

describe("chave no extrato", () => {
  it("mesma chave, mesmo tipo e mesmo valor devolve a entrada existente", async () => {
    const { ledger } = setup();
    const first = await ledger.append(WS, "AUTHORIZE", brl(100), "envelope", {
      idempotencyKey: "k",
    });
    const retry = await ledger.append(WS, "AUTHORIZE", brl(100), "outro texto", {
      idempotencyKey: "k",
    });
    expect(retry.id).toBe(first.id);
    expect(retry.reason).toBe("envelope");
    expect(await ledger.entries(WS)).toHaveLength(1);
  });

  it("mesma chave com tipo diferente é conflito e não grava", async () => {
    const { ledger } = setup();
    await ledger.append(WS, "AUTHORIZE", brl(100), "envelope", {
      idempotencyKey: "k",
    });
    await expect(
      ledger.append(WS, "RESERVE", brl(100), "separa", { idempotencyKey: "k" }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect((await ledger.entries(WS)).map((e) => e.kind)).toEqual([
      "AUTHORIZE",
    ]);
  });

  it("mesma chave com valor ou moeda diferente é conflito e não grava", async () => {
    const { ledger } = setup();
    await ledger.append(WS, "AUTHORIZE", brl(100), "envelope", {
      idempotencyKey: "k-valor",
    });
    await expect(
      ledger.append(WS, "AUTHORIZE", brl(40), "outro valor", {
        idempotencyKey: "k-valor",
      }),
    ).rejects.toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });

    await ledger.append(WS, "AUTHORIZE", brl(100), "envelope", {
      idempotencyKey: "k-moeda",
    });
    await expect(
      ledger.append(WS, "AUTHORIZE", Money.fromMajor(100, "USD"), "usd", {
        idempotencyKey: "k-moeda",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const entries = await ledger.entries(WS);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.amount.equals(brl(100)))).toBe(true);
  });

  it("authorize com a mesma chave e outro valor não altera o envelope", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(500), "envelope", "auth-1");
    await expect(
      guard.authorize(WS, brl(200), "outro valor", "auth-1"),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    const pos = await guard.position(WS, "BRL");
    expect(pos.authorized.toMajor()).toBe(500);
  });

  it("o store recusa chave repetida com outro movimento e não duplica a que bate", async () => {
    const { ledgerStore } = setup();
    const at = new Date("2026-09-02T12:00:00Z");
    const base: CapitalEntry = {
      id: CapitalEntryId("e-1"),
      workspaceId: WS,
      kind: "AUTHORIZE",
      amount: brl(100),
      at,
      reason: "envelope",
      idempotencyKey: "k",
    };
    await ledgerStore.append(base);
    await ledgerStore.append({
      ...base,
      id: CapitalEntryId("e-2"),
      reason: "retry",
    });
    await expect(
      ledgerStore.append({
        ...base,
        id: CapitalEntryId("e-3"),
        kind: "SPEND",
        amount: brl(10),
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const entries = await ledgerStore.entries(WS);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(CapitalEntryId("e-1"));
    expect(entries[0]?.kind).toBe("AUTHORIZE");
    expect((await ledgerStore.findByIdempotencyKey(WS, "k"))?.amount.toMajor()).toBe(
      100,
    );
  });
});

describe("configuração do colchão", () => {
  it("rejeita pendingBufferRatio negativo, acima de 1 ou não finito", () => {
    expect(() => setup(-0.01)).toThrow(/pendingBufferRatio/);
    expect(() => setup(-1)).toThrow(/entre 0 e 1/);
    expect(() => setup(1.01)).toThrow(/pendingBufferRatio/);
    expect(() => setup(Number.NaN)).toThrow(/pendingBufferRatio/);
    expect(() => setup(Number.POSITIVE_INFINITY)).toThrow(/pendingBufferRatio/);
  });

  it("aceita os extremos 0 e 1", async () => {
    const aberto = setup(0);
    await aberto.guard.authorize(WS, brl(100), "envelope");
    expect((await aberto.guard.spendableNow(WS, "BRL")).toMajor()).toBe(100);

    const cheio = setup(1);
    await cheio.guard.authorize(WS, brl(100), "envelope");
    const r = await cheio.guard.reserve(WS, brl(40), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");
    await cheio.guard.commit(r.value.id, "executado");
    // disponível 60, colchão de 100% sobre 40 comprometido → 20
    expect((await cheio.guard.spendableNow(WS, "BRL")).toMajor()).toBe(20);
  });
});

describe("ciclo de vida da reserva", () => {
  it("release devolve o dinheiro ao disponível", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const r = await guard.reserve(WS, brl(40), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");

    await guard.release(r.value.id, "campanha cancelada antes de executar");
    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(0);
    expect(pos.available.toMajor()).toBe(100);
  });

  it("commit vira exposição real e não some do total", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const r = await guard.reserve(WS, brl(40), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");

    await guard.commit(r.value.id, "anúncio criado no provedor");
    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(0);
    expect(pos.committed.toMajor()).toBe(40);
    expect(pos.available.toMajor()).toBe(60); // continua fora do disponível
  });

  it("não dá para comprometer duas vezes a mesma reserva", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const r = await guard.reserve(WS, brl(40), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");

    await guard.commit(r.value.id, "primeira execução");
    const dobra = await guard.commit(r.value.id, "retry indevido");
    expect(dobra.allowed).toBe(false);
    if (dobra.allowed) throw new Error("deveria negar");
    expect(dobra.reason).toBe("RESERVATION_ALREADY_SETTLED");

    const pos = await guard.position(WS, "BRL");
    expect(pos.committed.toMajor()).toBe(40); // não 80
  });

  it("não dá para liberar uma reserva já comprometida", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const r = await guard.reserve(WS, brl(40), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");
    await guard.commit(r.value.id, "executado");

    const release = await guard.release(r.value.id, "tentativa de desfazer");
    expect(release.allowed).toBe(false);
    const pos = await guard.position(WS, "BRL");
    expect(pos.committed.toMajor()).toBe(40);
  });
});

describe("atraso de relato do provedor", () => {
  it("gasto reportado sai de comprometido e vira gasto, sem dobrar exposição", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const r = await guard.reserve(WS, brl(40), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");
    await guard.commit(r.value.id, "executado");

    await guard.recordSpend(WS, brl(37.5), "provedor reportou entrega", {
      reservationId: r.value.id,
    });

    const pos = await guard.position(WS, "BRL");
    expect(pos.spent.toMajor()).toBe(37.5);
    expect(pos.committed.toMajor()).toBe(2.5); // resto ainda por confirmar
    expect(pos.exposure.toMajor()).toBe(40);
    expect(pos.available.toMajor()).toBe(60);
  });

  it("gasto acima do comprometido não é escondido: vira exposição real", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const r = await guard.reserve(WS, brl(40), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");
    await guard.commit(r.value.id, "executado");

    // a entrega estourou o orçamento no fim do dia
    await guard.recordSpend(WS, brl(46), "provedor reportou entrega acima");
    const pos = await guard.position(WS, "BRL");
    expect(pos.spent.toMajor()).toBe(46);
    expect(pos.exposure.toMajor()).toBe(46); // -6 comprometido + 46 gasto
    expect(pos.available.toMajor()).toBe(54);
  });

  it("colchão reduz o que pode ser comprometido enquanto o gasto não confirma", async () => {
    const { guard } = setup(0.1); // 10% de colchão
    await guard.authorize(WS, brl(100), "envelope");
    const r = await guard.reserve(WS, brl(50), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");
    await guard.commit(r.value.id, "executado");

    // disponível cru = 50, mas 10% de 50 comprometido vira colchão
    const spendable = await guard.spendableNow(WS, "BRL");
    expect(spendable.toMajor()).toBe(45);

    const denied = await guard.reserve(WS, brl(48), "acima do colchão");
    expect(denied.allowed).toBe(false);
  });
});

describe("invariantes do extrato", () => {
  it("valor negativo é rejeitado na origem", async () => {
    const { ledger } = setup();
    await expect(
      ledger.append(WS, "AUTHORIZE", Money.fromMinor(-100, "BRL"), "inválido"),
    ).rejects.toThrow(/negativo/);
  });

  it("revogar reduz o teto e pode deixar o disponível negativo — sem esconder", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const r = await guard.reserve(WS, brl(90), "ação");
    expect(r.allowed).toBe(true);

    await guard.revoke(WS, brl(50), "operador reduziu o envelope");
    const pos = await guard.position(WS, "BRL");
    expect(pos.authorized.toMajor()).toBe(50);
    expect(pos.available.toMajor()).toBe(-40); // exposição já contratada
    // e nada mais pode ser reservado nesse estado
    const nova = await guard.reserve(WS, brl(1), "tentativa");
    expect(nova.allowed).toBe(false);
  });

  it("RELEASE ou COMMIT acima do reservado é recusado e não reduz a exposição", async () => {
    const { guard, ledger } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    const r = await guard.reserve(WS, brl(40), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");

    await expect(
      ledger.append(WS, "RELEASE", brl(50), "maior que o reservado"),
    ).rejects.toThrow(/reservado negativo/);
    await expect(
      ledger.append(WS, "COMMIT", brl(41), "maior que o reservado"),
    ).rejects.toThrow(/reservado negativo/);

    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(40);
    expect(pos.exposure.toMajor()).toBe(40);
    expect(pos.available.toMajor()).toBe(60);

    const committed = await guard.commit(r.value.id, "executado");
    expect(committed.allowed).toBe(true);
    const after = await guard.position(WS, "BRL");
    expect(after.reserved.toMajor()).toBe(0);
    expect(after.committed.toMajor()).toBe(40);
    expect(after.exposure.toMajor()).toBe(40);
  });

  it("retry da mesma RELEASE não é recusado depois que o reservado já zerou", async () => {
    const { guard, ledger } = setup();
    await guard.authorize(WS, brl(100), "envelope");
    await ledger.append(WS, "RESERVE", brl(40), "separado", {
      idempotencyKey: "res-1",
      reservationId: ReservationId("res-1"),
    });
    const first = await ledger.append(WS, "RELEASE", brl(40), "devolve", {
      idempotencyKey: "rel-1",
      reservationId: ReservationId("res-1"),
    });
    const retry = await ledger.append(WS, "RELEASE", brl(40), "devolve", {
      idempotencyKey: "rel-1",
      reservationId: ReservationId("res-1"),
    });
    expect(retry.id).toBe(first.id);
    const pos = await guard.position(WS, "BRL");
    expect(pos.reserved.toMajor()).toBe(0);
    expect(pos.exposure.toMajor()).toBe(0);
    expect(pos.available.toMajor()).toBe(100);
    expect(
      (await ledger.entries(WS)).filter((e) => e.kind === "RELEASE"),
    ).toHaveLength(1);
  });

  it("extrato com reservado negativo não abate a exposição", () => {
    const at = new Date("2026-09-02T12:00:00Z");
    const entry = (
      id: string,
      kind: CapitalEntry["kind"],
      minor: number,
    ): CapitalEntry => ({
      id: CapitalEntryId(id),
      workspaceId: WS,
      kind,
      amount: Money.fromMinor(minor, "BRL"),
      at,
      reason: "extrato inconsistente",
    });

    const pos = derivePosition(
      [
        entry("e-auth", "AUTHORIZE", 10_000),
        entry("e-res", "RESERVE", 1_000),
        entry("e-rel", "RELEASE", 2_500),
      ],
      "BRL",
    );
    // A soma fica visível; o negativo não devolve capital.
    expect(pos.reserved.minor).toBe(-1_500);
    expect(pos.exposure.minor).toBe(0);
    expect(pos.available.minor).toBe(10_000);
    expect(pos.exposure.isNegative()).toBe(false);
  });

  it("a posição é função pura das entradas (reprocessável)", async () => {
    const { guard, ledger } = setup();
    await guard.authorize(WS, brl(200), "envelope");
    const r = await guard.reserve(WS, brl(60), "ação");
    if (!r.allowed) throw new Error("reserva deveria passar");
    await guard.commit(r.value.id, "executado");
    await guard.recordSpend(WS, brl(60), "reportado");

    const entries = await ledger.entries(WS);
    const derived = derivePosition(entries, "BRL");
    const live = await guard.position(WS, "BRL");
    expect(derived).toEqual(live);
  });

  it("reserva ausente não inventa posição em BRL", async () => {
    const { guard, ledger } = setup();
    await guard.authorize(WS, Money.fromMajor(80, "USD"), "envelope USD");
    const missing = ReservationId("nao-existe");

    const released = await guard.release(missing, "liberar");
    const committed = await guard.commit(missing, "comprometer");
    for (const outcome of [released, committed]) {
      expect(outcome.allowed).toBe(false);
      if (outcome.allowed) throw new Error("deveria negar");
      expect(outcome.reason).toBe("RESERVATION_NOT_FOUND");
      expect("position" in outcome).toBe(false);
      expect(outcome.detail).toContain(String(missing));
    }

    expect(await ledger.entries(WS)).toHaveLength(1);
    const pos = await guard.position(WS, "USD");
    expect(pos.authorized.toMajor()).toBe(80);
    expect(pos.currency).toBe("USD");
  });

  it("reserva na moeda errada é CURRENCY_MISMATCH, não falta de autorização", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope BRL");
    const denied = await guard.reserve(
      WS,
      Money.fromMajor(10, "USD"),
      "ação em dólar",
    );
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error("deveria negar");
    expect(denied.reason).toBe("CURRENCY_MISMATCH");
    expect(denied.detail).toContain("USD");
    expect(denied.detail).toContain("BRL");
    expect(denied.position.currency).toBe("USD");
    expect(denied.position.authorized.isZero()).toBe(true);
    expect(denied.position.reserved.isZero()).toBe(true);

    const brlPos = await guard.position(WS, "BRL");
    expect(brlPos.authorized.toMajor()).toBe(100);
    expect(brlPos.reserved.toMajor()).toBe(0);
    const usdPos = await guard.position(WS, "USD");
    expect(usdPos.reserved.toMajor()).toBe(0);
  });

  it("as duas moedas autorizadas, a reserva na segunda não é mismatch", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope BRL");
    await guard.authorize(WS, Money.fromMajor(50, "USD"), "envelope USD");
    const reserved = await guard.reserve(
      WS,
      Money.fromMajor(10, "USD"),
      "ação em dólar",
    );
    expect(reserved.allowed).toBe(true);
    const pos = await guard.position(WS, "USD");
    expect(pos.reserved.toMajor()).toBe(10);
    expect(pos.authorized.toMajor()).toBe(50);
  });

  it("moeda sem nenhuma autorização no workspace continua NO_AUTHORIZATION", async () => {
    const { guard } = setup();
    const denied = await guard.reserve(WS, Money.fromMajor(1, "EUR"), "nada");
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error("deveria negar");
    expect(denied.reason).toBe("NO_AUTHORIZATION");
    expect(denied.position.currency).toBe("EUR");
  });

  it("terceira moeda, com outras autorizadas, cita as moedas reais", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope BRL");
    await guard.authorize(WS, Money.fromMajor(40, "USD"), "envelope USD");
    const denied = await guard.reserve(WS, Money.fromMajor(5, "EUR"), "euro");
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error("deveria negar");
    expect(denied.reason).toBe("CURRENCY_MISMATCH");
    expect(denied.detail).toContain("BRL");
    expect(denied.detail).toContain("USD");
    expect(denied.position.currency).toBe("EUR");
    expect(denied.position.reserved.isZero()).toBe(true);
  });

  it("moeda diferente não se mistura na mesma posição", async () => {
    const { guard } = setup();
    await guard.authorize(WS, brl(100), "envelope BRL");
    await guard.authorize(WS, Money.fromMajor(50, "USD"), "envelope USD");
    const posBrl = await guard.position(WS, "BRL");
    const posUsd = await guard.position(WS, "USD");
    expect(posBrl.authorized.toMajor()).toBe(100);
    expect(posUsd.authorized.toMajor()).toBe(50);
  });
});
