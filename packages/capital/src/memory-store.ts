/**
 * Implementação em memória do extrato e das reservas.
 *
 * Não é um mock de conveniência: é a implementação de referência contra a
 * qual o comportamento do Capital Guard é especificado. Quando a versão
 * Oracle existir, ela terá que passar exatamente na mesma bateria de testes
 * (testes de contrato), e divergência entre as duas é bug da Oracle.
 */
import type { CapitalEntryId, WorkspaceId, ReservationId } from "@forge/domain";
import {
  IdempotencyConflictError,
  type CapitalEntry,
  type CapitalLedgerStore,
} from "./ledger.js";
import type { Reservation, ReservationStore } from "./guard.js";

export class InMemoryCapitalLedgerStore implements CapitalLedgerStore {
  private readonly byWorkspace = new Map<string, CapitalEntry[]>();
  private readonly byKey = new Map<string, CapitalEntry>();

  async append(entry: CapitalEntry): Promise<void> {
    if (entry.idempotencyKey) {
      const mapKey = `${entry.workspaceId}::${entry.idempotencyKey}`;
      const existing = this.byKey.get(mapKey);
      if (existing) {
        // Mesma chave não é a mesma entrada se o tipo ou o valor mudou.
        // Bater os dois é no-op: a linha original continua a única.
        if (
          existing.kind === entry.kind &&
          existing.amount.equals(entry.amount)
        ) {
          return;
        }
        throw new IdempotencyConflictError(
          `Chave de idempotência já pertence a ${existing.kind} de ${existing.amount.toString()}; ` +
            `o movimento pedido é ${entry.kind} de ${entry.amount.toString()}`,
        );
      }
    }
    const list = this.byWorkspace.get(entry.workspaceId) ?? [];
    list.push(entry);
    this.byWorkspace.set(entry.workspaceId, list);
    if (entry.idempotencyKey) {
      this.byKey.set(`${entry.workspaceId}::${entry.idempotencyKey}`, entry);
    }
  }

  async entries(workspaceId: WorkspaceId): Promise<readonly CapitalEntry[]> {
    return [...(this.byWorkspace.get(workspaceId) ?? [])];
  }

  async findByIdempotencyKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<CapitalEntry | undefined> {
    return this.byKey.get(`${workspaceId}::${key}`);
  }

  /** Só para inspeção em teste. */
  all(): readonly CapitalEntry[] {
    return [...this.byWorkspace.values()].flat();
  }

  find(id: CapitalEntryId): CapitalEntry | undefined {
    return this.all().find((e) => e.id === id);
  }
}

export class InMemoryReservationStore implements ReservationStore {
  private readonly items = new Map<string, Reservation>();

  async save(reservation: Reservation): Promise<void> {
    this.items.set(reservation.id, reservation);
  }

  async get(id: ReservationId): Promise<Reservation | undefined> {
    return this.items.get(id);
  }

  all(): readonly Reservation[] {
    return [...this.items.values()];
  }
}
