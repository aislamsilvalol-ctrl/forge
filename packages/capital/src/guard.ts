/**
 * CAPITAL GUARD — o único caminho para o dinheiro sair.
 *
 * Nenhuma mutação no provedor de anúncios acontece sem passar por aqui.
 * O Guard não opina, não estima e não é persuadível: ele compara números
 * inteiros contra um teto e devolve permitido ou negado com o motivo.
 *
 * Duas defesas que não são óbvias e existem por razão prática:
 *
 * 1. ATRASO DE RELATO (item 36). O provedor reporta gasto com atraso de
 *    horas. Calcular `disponível = autorizado − último_número_da_API` trata
 *    dinheiro já gasto como se ainda existisse. Por isso o cálculo usa
 *    reservado + comprometido + gasto, e ainda aplica um colchão sobre o
 *    comprometido que ainda não foi confirmado.
 *
 * 2. SERIALIZAÇÃO POR WORKSPACE. Dois workers decidindo ao mesmo tempo
 *    podem cada um ler "sobra R$100" e cada um reservar R$80. A checagem e
 *    a escrita acontecem dentro de uma seção crítica por workspace.
 */
import {
  Money,
  type Currency,
  type Clock,
  type IdGenerator,
  type ReservationId,
  type WorkspaceId,
} from "@forge/domain";
import {
  CapitalLedger,
  type CapitalPosition,
  type CapitalLedgerStore,
} from "./ledger.js";

export type DenialReason =
  | "EXCEEDS_AUTHORIZED"
  | "NO_AUTHORIZATION"
  | "AMOUNT_NOT_POSITIVE"
  | "CURRENCY_MISMATCH"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_ALREADY_SETTLED";

export type GuardOutcome<T> =
  | { readonly allowed: true; readonly value: T }
  | {
      readonly allowed: false;
      readonly reason: DenialReason;
      /** Mensagem para humano, com os números que motivaram a negativa. */
      readonly detail: string;
      readonly position: CapitalPosition;
    };

export interface Reservation {
  readonly id: ReservationId;
  readonly workspaceId: WorkspaceId;
  readonly amount: Money;
  readonly reason: string;
  readonly at: Date;
  readonly state: "OPEN" | "COMMITTED" | "RELEASED";
}

export interface ReservationStore {
  save(reservation: Reservation): Promise<void>;
  get(id: ReservationId): Promise<Reservation | undefined>;
}

/** Trava por chave — em memória no V1; Oracle/Redis quando houver múltiplos nós. */
export interface Mutex {
  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export class InProcessMutex implements Mutex {
  private readonly chains = new Map<string, Promise<unknown>>();
  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    // encadeia: a próxima chamada só roda quando a anterior terminar
    const current = previous.then(fn, fn);
    this.chains.set(
      key,
      current.catch(() => undefined),
    );
    try {
      return await current;
    } finally {
      if (this.chains.get(key) === current) this.chains.delete(key);
    }
  }
}

export interface CapitalGuardOptions {
  /**
   * Fração do comprometido-não-confirmado tratada como risco adicional.
   * Cobre a entrega estourar o orçamento entre a execução e o relato.
   * 0.1 = considera 10% a mais do que foi comprometido.
   */
  readonly pendingBufferRatio?: number;
}

export class CapitalGuard {
  private readonly bufferRatio: number;

  constructor(
    private readonly ledger: CapitalLedger,
    private readonly reservations: ReservationStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly mutex: Mutex = new InProcessMutex(),
    options: CapitalGuardOptions = {},
  ) {
    this.bufferRatio = options.pendingBufferRatio ?? 0.1;
  }

  /** Autoriza capital. É o único ponto que AUMENTA o que o motor pode gastar. */
  async authorize(
    workspaceId: WorkspaceId,
    amount: Money,
    reason: string,
    idempotencyKey?: string,
  ): Promise<CapitalPosition> {
    return this.mutex.runExclusive(workspaceId, async () => {
      await this.ledger.append(workspaceId, "AUTHORIZE", amount, reason, {
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return this.ledger.position(workspaceId, amount.currency);
    });
  }

  async revoke(
    workspaceId: WorkspaceId,
    amount: Money,
    reason: string,
  ): Promise<CapitalPosition> {
    return this.mutex.runExclusive(workspaceId, async () => {
      await this.ledger.append(workspaceId, "REVOKE", amount, reason);
      return this.ledger.position(workspaceId, amount.currency);
    });
  }

  async position(
    workspaceId: WorkspaceId,
    currency: Currency,
  ): Promise<CapitalPosition> {
    return this.ledger.position(workspaceId, currency);
  }

  /**
   * Quanto o motor pode comprometer AGORA, já descontado o colchão do
   * gasto pendente de confirmação. É este número — não `available` cru —
   * que qualquer alocador deve consultar.
   */
  async spendableNow(
    workspaceId: WorkspaceId,
    currency: Currency,
  ): Promise<Money> {
    const p = await this.ledger.position(workspaceId, currency);
    return this.applyBuffer(p);
  }

  private applyBuffer(p: CapitalPosition): Money {
    const buffer = p.committed.isPositive()
      ? p.committed.times(this.bufferRatio)
      : Money.zero(p.currency);
    const spendable = p.available.minus(buffer);
    return spendable.isNegative() ? Money.zero(p.currency) : spendable;
  }

  /**
   * Separa capital para uma ação que ainda será executada. Reservar não gasta:
   * é o passo que garante que duas decisões concorrentes não prometam o mesmo
   * dinheiro.
   */
  async reserve(
    workspaceId: WorkspaceId,
    amount: Money,
    reason: string,
    idempotencyKey?: string,
  ): Promise<GuardOutcome<Reservation>> {
    return this.mutex.runExclusive(workspaceId, async () => {
      if (!amount.isPositive()) {
        const position = await this.ledger.position(
          workspaceId,
          amount.currency,
        );
        return {
          allowed: false as const,
          reason: "AMOUNT_NOT_POSITIVE" as const,
          detail: `Reserva precisa ser positiva, recebido ${amount.toString()}`,
          position,
        };
      }

      const position = await this.ledger.position(workspaceId, amount.currency);
      if (position.authorized.isZero()) {
        return {
          allowed: false as const,
          reason: "NO_AUTHORIZATION" as const,
          detail:
            "Nenhum capital autorizado neste workspace — o operador precisa " +
            "definir o envelope antes de qualquer execução",
          position,
        };
      }

      const spendable = this.applyBuffer(position);
      if (amount.gt(spendable)) {
        return {
          allowed: false as const,
          reason: "EXCEEDS_AUTHORIZED" as const,
          detail:
            `Reserva de ${amount.toString()} excede o disponível ` +
            `${spendable.toString()} (autorizado ${position.authorized.toString()}, ` +
            `exposição ${position.exposure.toString()})`,
          position,
        };
      }

      const entry = await this.ledger.append(
        workspaceId,
        "RESERVE",
        amount,
        reason,
        { ...(idempotencyKey ? { idempotencyKey } : {}) },
      );
      // idempotência: se a entrada já existia, devolve a reserva original
      const existing = entry.reservationId
        ? await this.reservations.get(entry.reservationId)
        : undefined;
      if (existing) return { allowed: true as const, value: existing };

      const reservation: Reservation = {
        id: this.ids.next() as ReservationId,
        workspaceId,
        amount,
        reason,
        at: this.clock.now(),
        state: "OPEN",
      };
      await this.reservations.save(reservation);
      return { allowed: true as const, value: reservation };
    });
  }

  /** A ação não vai acontecer: devolve a reserva ao disponível. */
  async release(
    reservationId: ReservationId,
    reason: string,
  ): Promise<GuardOutcome<Reservation>> {
    const reservation = await this.reservations.get(reservationId);
    if (!reservation) {
      return this.notFound(reservationId);
    }
    return this.mutex.runExclusive(reservation.workspaceId, async () => {
      const fresh = await this.reservations.get(reservationId);
      if (!fresh) return this.notFound(reservationId);
      if (fresh.state !== "OPEN") {
        return {
          allowed: false as const,
          reason: "RESERVATION_ALREADY_SETTLED" as const,
          detail: `Reserva ${reservationId} já está ${fresh.state}`,
          position: await this.ledger.position(
            fresh.workspaceId,
            fresh.amount.currency,
          ),
        };
      }
      await this.ledger.append(
        fresh.workspaceId,
        "RELEASE",
        fresh.amount,
        reason,
        { reservationId },
      );
      const updated: Reservation = { ...fresh, state: "RELEASED" };
      await this.reservations.save(updated);
      return { allowed: true as const, value: updated };
    });
  }

  /**
   * A ação foi executada no provedor. A partir daqui existe exposição real:
   * o dinheiro pode sair mesmo que nada mais seja decidido.
   */
  async commit(
    reservationId: ReservationId,
    reason: string,
  ): Promise<GuardOutcome<Reservation>> {
    const reservation = await this.reservations.get(reservationId);
    if (!reservation) return this.notFound(reservationId);
    return this.mutex.runExclusive(reservation.workspaceId, async () => {
      const fresh = await this.reservations.get(reservationId);
      if (!fresh) return this.notFound(reservationId);
      if (fresh.state !== "OPEN") {
        return {
          allowed: false as const,
          reason: "RESERVATION_ALREADY_SETTLED" as const,
          detail: `Reserva ${reservationId} já está ${fresh.state}`,
          position: await this.ledger.position(
            fresh.workspaceId,
            fresh.amount.currency,
          ),
        };
      }
      await this.ledger.append(
        fresh.workspaceId,
        "COMMIT",
        fresh.amount,
        reason,
        { reservationId },
      );
      const updated: Reservation = { ...fresh, state: "COMMITTED" };
      await this.reservations.save(updated);
      return { allowed: true as const, value: updated };
    });
  }

  /**
   * O provedor reportou gasto. Aceita valor diferente do comprometido — a
   * entrega real quase nunca bate com o orçamento, e mascarar a diferença
   * seria mentir para o Guard.
   */
  async recordSpend(
    workspaceId: WorkspaceId,
    amount: Money,
    reason: string,
    options: { reservationId?: ReservationId; idempotencyKey?: string } = {},
  ): Promise<CapitalPosition> {
    return this.mutex.runExclusive(workspaceId, async () => {
      await this.ledger.append(workspaceId, "SPEND", amount, reason, options);
      return this.ledger.position(workspaceId, amount.currency);
    });
  }

  private async notFound(
    id: ReservationId,
  ): Promise<GuardOutcome<Reservation>> {
    return {
      allowed: false,
      reason: "RESERVATION_NOT_FOUND",
      detail: `Reserva ${id} não encontrada`,
      position: {
        currency: "BRL",
        authorized: Money.zero("BRL"),
        reserved: Money.zero("BRL"),
        committed: Money.zero("BRL"),
        spent: Money.zero("BRL"),
        available: Money.zero("BRL"),
        exposure: Money.zero("BRL"),
      },
    };
  }
}
