/**
 * IDs tipados por marca (branded types).
 *
 * Por que: `campaignId: string` e `workspaceId: string` são o mesmo tipo para
 * o compilador, então trocar a ordem de dois argumentos passa despercebido —
 * num motor que move dinheiro entre campanhas isso é um bug caro e silencioso.
 * A marca existe só em tempo de compilação; em runtime continua string.
 */
declare const brand: unique symbol;

type Branded<T, B extends string> = T & { readonly [brand]: B };

export type WorkspaceId = Branded<string, "WorkspaceId">;
export type CampaignId = Branded<string, "CampaignId">;
export type AdSetId = Branded<string, "AdSetId">;
export type AdId = Branded<string, "AdId">;
export type CreativeId = Branded<string, "CreativeId">;
export type DecisionId = Branded<string, "DecisionId">;
export type ExperimentId = Branded<string, "ExperimentId">;
export type CapitalEntryId = Branded<string, "CapitalEntryId">;
export type ReservationId = Branded<string, "ReservationId">;

const make =
  <T extends string>() =>
  (raw: string): T => {
    if (!raw) throw new Error("ID não pode ser vazio");
    return raw as T;
  };

export const WorkspaceId = make<WorkspaceId>();
export const CampaignId = make<CampaignId>();
export const AdSetId = make<AdSetId>();
export const AdId = make<AdId>();
export const CreativeId = make<CreativeId>();
export const DecisionId = make<DecisionId>();
export const ExperimentId = make<ExperimentId>();
export const CapitalEntryId = make<CapitalEntryId>();
export const ReservationId = make<ReservationId>();

/**
 * Relógio injetável. Testes de decaimento temporal, janelas de cooldown e
 * expiração de reserva precisam controlar o tempo — `Date.now()` espalhado
 * pelo domínio tornaria isso impossível de testar sem esperar de verdade.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = date;
  }
}

/** Gerador de ID injetável — determinismo nos testes, ULID/UUID em produção. */
export interface IdGenerator {
  next(): string;
}

export const randomIdGenerator: IdGenerator = {
  next: () => globalThis.crypto.randomUUID(),
};

export class SequentialIdGenerator implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix = "id") {}
  next(): string {
    this.n += 1;
    return `${this.prefix}-${this.n}`;
  }
}
