/**
 * CAPITAL LEDGER — o extrato imutável do dinheiro autorizado.
 *
 * Regra número um do produto: NUNCA ULTRAPASSAR O CAPITAL AUTORIZADO.
 * Ela vive aqui, em código determinístico, e não num prompt — um modelo de
 * linguagem não pode ser convencido a liberar gasto porque não é ele quem
 * decide. Todo movimento vira uma entrada; o saldo é derivado das entradas,
 * nunca um campo mutável que alguém possa sobrescrever.
 *
 * Estados do dinheiro (item 35 do spec):
 *   AUTHORIZE  o operador liberou X para o motor usar
 *   RESERVE    o motor separou parte para uma ação que vai executar
 *   COMMIT     a ação foi executada no provedor (exposição real começou)
 *   SPEND      o provedor reportou gasto efetivo
 *   RELEASE    a ação não aconteceu; a reserva volta a ficar disponível
 *   REVOKE     o operador reduziu a autorização
 */
import {
  Money,
  type Currency,
  type CapitalEntryId,
  type Clock,
  type IdGenerator,
  type ReservationId,
  type WorkspaceId,
} from "@forge/domain";

export type CapitalEntryKind =
  | "AUTHORIZE"
  | "REVOKE"
  | "RESERVE"
  | "RELEASE"
  | "COMMIT"
  | "SPEND";

export interface CapitalEntry {
  readonly id: CapitalEntryId;
  readonly workspaceId: WorkspaceId;
  readonly kind: CapitalEntryKind;
  readonly amount: Money;
  readonly at: Date;
  /** Liga a entrada a uma reserva (RESERVE/RELEASE/COMMIT/SPEND). */
  readonly reservationId?: ReservationId;
  /** Por que este movimento existe — auditoria legível. */
  readonly reason: string;
  /**
   * Chave de idempotência do chamador. Duas tentativas com a mesma chave
   * produzem UMA entrada: retry de rede não pode reservar duas vezes.
   */
  readonly idempotencyKey?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface CapitalPosition {
  readonly currency: Currency;
  /** Teto autorizado pelo operador, já descontadas revogações. */
  readonly authorized: Money;
  /** Separado para ações decididas mas ainda não executadas. */
  readonly reserved: Money;
  /** Executado no provedor, aguardando o gasto ser reportado. */
  readonly committed: Money;
  /** Gasto confirmado pelo provedor. */
  readonly spent: Money;
  /** O que o motor ainda pode comprometer agora. */
  readonly available: Money;
  /** Exposição total: já saiu ou pode sair sem nova decisão. */
  readonly exposure: Money;
}

export interface CapitalLedgerStore {
  append(entry: CapitalEntry): Promise<void>;
  entries(workspaceId: WorkspaceId): Promise<readonly CapitalEntry[]>;
  findByIdempotencyKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<CapitalEntry | undefined>;
}

/**
 * Deriva a posição a partir das entradas. É uma função pura sobre o extrato:
 * o mesmo conjunto de entradas sempre produz a mesma posição, o que permite
 * reprocessar o histórico e conferir contra a fatura do provedor.
 */
export function derivePosition(
  entries: readonly CapitalEntry[],
  currency: Currency,
): CapitalPosition {
  const zero = Money.zero(currency);
  let authorized = zero;
  let reserved = zero;
  let committed = zero;
  let spent = zero;

  for (const e of entries) {
    if (e.amount.currency !== currency) continue;
    switch (e.kind) {
      case "AUTHORIZE":
        authorized = authorized.plus(e.amount);
        break;
      case "REVOKE":
        authorized = authorized.minus(e.amount);
        break;
      case "RESERVE":
        reserved = reserved.plus(e.amount);
        break;
      case "RELEASE":
        reserved = reserved.minus(e.amount);
        break;
      case "COMMIT":
        // sai de reservado e vira exposição real no provedor
        reserved = reserved.minus(e.amount);
        committed = committed.plus(e.amount);
        break;
      case "SPEND":
        // O provedor reportou: deixa de ser previsão e vira gasto.
        // `committed` nunca fica negativo — quando a entrega estoura o
        // orçamento (acontece no fim do dia), um saldo negativo aqui
        // abateria a exposição e mostraria MENOS dinheiro fora do que
        // realmente saiu. O excedente fica visível em `spent`.
        committed = committed.minus(e.amount);
        if (committed.isNegative()) committed = Money.zero(currency);
        spent = spent.plus(e.amount);
        break;
    }
  }

  const exposure = reserved.plus(committed).plus(spent);
  const available = authorized.minus(exposure);
  return {
    currency,
    authorized,
    reserved,
    committed,
    spent,
    available,
    exposure,
  };
}

export interface AppendOptions {
  readonly reservationId?: ReservationId;
  readonly idempotencyKey?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export class CapitalLedger {
  constructor(
    private readonly store: CapitalLedgerStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async position(
    workspaceId: WorkspaceId,
    currency: Currency,
  ): Promise<CapitalPosition> {
    return derivePosition(await this.store.entries(workspaceId), currency);
  }

  async entries(workspaceId: WorkspaceId): Promise<readonly CapitalEntry[]> {
    return this.store.entries(workspaceId);
  }

  /**
   * Registra um movimento. Se a mesma `idempotencyKey` já foi usada neste
   * workspace, devolve a entrada original sem criar outra — é o que impede
   * que um retry do worker reserve capital duas vezes.
   */
  async append(
    workspaceId: WorkspaceId,
    kind: CapitalEntryKind,
    amount: Money,
    reason: string,
    options: AppendOptions = {},
  ): Promise<CapitalEntry> {
    if (amount.isNegative()) {
      throw new Error(
        `Movimento de capital não aceita valor negativo: ${amount.toString()}`,
      );
    }
    if (options.idempotencyKey) {
      const existing = await this.store.findByIdempotencyKey(
        workspaceId,
        options.idempotencyKey,
      );
      if (existing) return existing;
    }
    const entry: CapitalEntry = {
      id: this.ids.next() as CapitalEntryId,
      workspaceId,
      kind,
      amount,
      at: this.clock.now(),
      reason,
      ...(options.reservationId ? { reservationId: options.reservationId } : {}),
      ...(options.idempotencyKey
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
      ...(options.meta ? { meta: options.meta } : {}),
    };
    await this.store.append(entry);
    return entry;
  }
}
