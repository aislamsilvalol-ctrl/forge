/**
 * DECISION LEDGER — o histórico do que o motor decidiu e por quê.
 *
 * Uma decisão nunca é sobrescrita. Cada mudança de estado acrescenta uma
 * transição ao registro, de modo que "por que o motor aumentou o orçamento
 * às 10:44" continua respondível meses depois — inclusive quando a decisão
 * deu errado e foi revertida. Sem isso não há aprendizado auditável: só
 * um número que mudou sozinho.
 *
 * Nenhuma alteração financeira nasce da resposta de um modelo de linguagem
 * (item 30). O modelo pode PROPOR; a validação determinística e o Sentinel
 * decidem se a proposta vira execução.
 */
import type {
  Clock,
  DecisionId,
  IdGenerator,
  Money,
  WorkspaceId,
} from "@forge/domain";

export type DecisionStatus =
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "OBSERVED"
  | "EVALUATED"
  | "ROLLED_BACK";

export type ActionType =
  | "INCREASE_BUDGET"
  | "DECREASE_BUDGET"
  | "PAUSE"
  | "RESUME"
  | "CREATE_CAMPAIGN"
  | "CREATE_AD"
  | "REQUEST_CREATIVE";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** Uma evidência observável que sustenta a decisão — nunca opinião solta. */
export interface Evidence {
  readonly kind: string;
  readonly summary: string;
  readonly value?: number;
  readonly sampleSize?: number;
  readonly source: string;
}

export interface ProposedOutcome {
  readonly metric: string;
  /** Faixa esperada, não ponto — previsão pontual finge certeza que não existe. */
  readonly expectedMin: number;
  readonly expectedMax: number;
}

export interface Guardrail {
  readonly description: string;
  /** Condição que, se violada, aciona o rollback. */
  readonly rollbackWhen: string;
}

export interface DecisionTransition {
  readonly at: Date;
  readonly from: DecisionStatus;
  readonly to: DecisionStatus;
  readonly by: string;
  readonly note: string;
}

export interface Decision {
  readonly id: DecisionId;
  readonly workspaceId: WorkspaceId;
  readonly createdAt: Date;
  readonly targetType: "CAMPAIGN" | "AD_SET" | "AD" | "WORKSPACE";
  readonly targetId: string;
  readonly action: ActionType;
  /** Explicação legível: o que sustenta esta decisão. */
  readonly reason: string;
  readonly evidence: readonly Evidence[];
  readonly expected: ProposedOutcome;
  /** 0..1 — de onde vem está em `evidence`, não é número mágico. */
  readonly confidence: number;
  readonly capitalAtRisk: Money;
  readonly risk: RiskLevel;
  readonly guardrails: readonly Guardrail[];
  readonly status: DecisionStatus;
  readonly transitions: readonly DecisionTransition[];
  /** Resultado medido depois da janela de observação. */
  readonly observed?: { readonly metric: string; readonly value: number };
  readonly meta?: Readonly<Record<string, unknown>>;
}

export class InvalidTransitionError extends Error {
  constructor(from: DecisionStatus, to: DecisionStatus) {
    super(`Transição inválida de decisão: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * A escrita apagaria uma decisão já gravada. Transição válida continua o
 * histórico; qualquer outro conteúdo no mesmo id é recusado.
 */
export class DecisionOverwriteError extends Error {
  constructor(id: string) {
    super(
      `Decisão ${id} já existe e a escrita apagaria o registro — ` +
        "uma decisão nova tem de continuar o histórico, não substituí-lo",
    );
    this.name = "DecisionOverwriteError";
  }
}

/**
 * Máquina de estados explícita. Uma decisão rejeitada não pode "voltar" a
 * ser executada, e uma executada não retorna a proposta — sem isso o
 * histórico poderia ser reescrito para parecer melhor do que foi.
 */
const ALLOWED: Record<DecisionStatus, readonly DecisionStatus[]> = {
  PROPOSED: ["APPROVED", "REJECTED"],
  APPROVED: ["EXECUTED", "REJECTED"],
  REJECTED: [],
  EXECUTED: ["OBSERVED", "ROLLED_BACK"],
  OBSERVED: ["EVALUATED", "ROLLED_BACK"],
  EVALUATED: ["ROLLED_BACK"],
  ROLLED_BACK: [],
};

export function canTransition(
  from: DecisionStatus,
  to: DecisionStatus,
): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export interface DecisionStore {
  save(decision: Decision): Promise<void>;
  get(id: DecisionId): Promise<Decision | undefined>;
  list(workspaceId: WorkspaceId): Promise<readonly Decision[]>;
}

export interface ProposeInput {
  readonly workspaceId: WorkspaceId;
  readonly targetType: Decision["targetType"];
  readonly targetId: string;
  readonly action: ActionType;
  readonly reason: string;
  readonly evidence: readonly Evidence[];
  readonly expected: ProposedOutcome;
  readonly confidence: number;
  readonly capitalAtRisk: Money;
  readonly risk: RiskLevel;
  readonly guardrails: readonly Guardrail[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

export class DecisionLedger {
  constructor(
    private readonly store: DecisionStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Registra uma proposta. Exige evidência: uma decisão sem nada que a
   * sustente não é uma decisão, é um palpite — e palpite não move dinheiro.
   */
  async propose(input: ProposeInput): Promise<Decision> {
    if (input.evidence.length === 0) {
      throw new Error(
        "Decisão sem evidência é rejeitada na origem — toda proposta " +
          "precisa declarar o que a sustenta",
      );
    }
    // NaN passa em `<` e `>`: as duas comparações são falsas. Infinito
    // também não é uma confiança calibrada.
    if (
      !Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1
    ) {
      throw new Error(`Confiança fora de 0..1: ${input.confidence}`);
    }
    if (input.expected.expectedMin > input.expected.expectedMax) {
      throw new Error("Faixa esperada invertida (mínimo maior que máximo)");
    }
    const now = this.clock.now();
    const decision: Decision = {
      id: this.ids.next() as DecisionId,
      workspaceId: input.workspaceId,
      createdAt: now,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      reason: input.reason,
      evidence: input.evidence,
      expected: input.expected,
      confidence: input.confidence,
      capitalAtRisk: input.capitalAtRisk,
      risk: input.risk,
      guardrails: input.guardrails,
      status: "PROPOSED",
      transitions: [],
      ...(input.meta ? { meta: input.meta } : {}),
    };
    await this.store.save(decision);
    return decision;
  }

  async transition(
    id: DecisionId,
    to: DecisionStatus,
    by: string,
    note: string,
  ): Promise<Decision> {
    const current = await this.store.get(id);
    if (!current) throw new Error(`Decisão ${id} não encontrada`);
    if (!canTransition(current.status, to)) {
      throw new InvalidTransitionError(current.status, to);
    }
    const updated: Decision = {
      ...current,
      status: to,
      transitions: [
        ...current.transitions,
        { at: this.clock.now(), from: current.status, to, by, note },
      ],
    };
    await this.store.save(updated);
    return updated;
  }

  /** Registra o que de fato aconteceu — base do aprendizado. */
  async observe(
    id: DecisionId,
    metric: string,
    value: number,
    by: string,
  ): Promise<Decision> {
    const current = await this.store.get(id);
    if (!current) throw new Error(`Decisão ${id} não encontrada`);
    if (!canTransition(current.status, "OBSERVED")) {
      throw new InvalidTransitionError(current.status, "OBSERVED");
    }
    const updated: Decision = {
      ...current,
      status: "OBSERVED",
      observed: { metric, value },
      transitions: [
        ...current.transitions,
        {
          at: this.clock.now(),
          from: current.status,
          to: "OBSERVED",
          by,
          note: `${metric}=${value}`,
        },
      ],
    };
    await this.store.save(updated);
    return updated;
  }

  async get(id: DecisionId): Promise<Decision | undefined> {
    return this.store.get(id);
  }

  async list(workspaceId: WorkspaceId): Promise<readonly Decision[]> {
    return this.store.list(workspaceId);
  }
}

/**
 * O resultado caiu dentro da faixa prevista? É a base da recompensa do
 * aprendizado: acertar a direção não basta, a previsão precisa ter sido
 * calibrada.
 */
export function outcomeWithinExpectation(decision: Decision): boolean | null {
  if (!decision.observed) return null;
  const { expectedMin, expectedMax } = decision.expected;
  const v = decision.observed.value;
  return v >= expectedMin && v <= expectedMax;
}

function sameTransition(
  left: DecisionTransition,
  right: DecisionTransition,
): boolean {
  return (
    left.at.getTime() === right.at.getTime() &&
    left.from === right.from &&
    left.to === right.to &&
    left.by === right.by &&
    left.note === right.note
  );
}

function sameObserved(
  left: Decision["observed"],
  right: Decision["observed"],
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.metric === right.metric && left.value === right.value;
}

/** Campos que uma transição não pode reescrever. */
function sameIdentity(prev: Decision, next: Decision): boolean {
  return (
    prev.id === next.id &&
    prev.workspaceId === next.workspaceId &&
    prev.createdAt.getTime() === next.createdAt.getTime() &&
    prev.targetType === next.targetType &&
    prev.targetId === next.targetId &&
    prev.action === next.action &&
    prev.reason === next.reason &&
    prev.evidence === next.evidence &&
    prev.expected === next.expected &&
    prev.confidence === next.confidence &&
    prev.capitalAtRisk.equals(next.capitalAtRisk) &&
    prev.risk === next.risk &&
    prev.guardrails === next.guardrails &&
    prev.meta === next.meta
  );
}

function sameSnapshot(prev: Decision, next: Decision): boolean {
  if (prev.status !== next.status) return false;
  if (prev.transitions.length !== next.transitions.length) return false;
  for (let i = 0; i < prev.transitions.length; i++) {
    const left = prev.transitions[i];
    const right = next.transitions[i];
    if (!left || !right || !sameTransition(left, right)) return false;
  }
  return sameObserved(prev.observed, next.observed);
}

/**
 * A segunda escrita ou é o mesmo snapshot, ou acrescenta exatamente uma
 * transição em cima da anterior. Qualquer outra forma apagaria histórico.
 */
function continuesDecision(prev: Decision, next: Decision): boolean {
  if (!sameIdentity(prev, next)) return false;
  if (sameSnapshot(prev, next)) return true;
  if (next.transitions.length !== prev.transitions.length + 1) return false;
  for (let i = 0; i < prev.transitions.length; i++) {
    const left = prev.transitions[i];
    const right = next.transitions[i];
    if (!left || !right || !sameTransition(left, right)) return false;
  }
  const added = next.transitions[next.transitions.length - 1];
  if (!added || added.from !== prev.status || added.to !== next.status) {
    return false;
  }
  if (prev.observed && !sameObserved(prev.observed, next.observed)) {
    return false;
  }
  if (!prev.observed && next.observed && next.status !== "OBSERVED") {
    return false;
  }
  return true;
}

export class InMemoryDecisionStore implements DecisionStore {
  private readonly items = new Map<string, Decision>();
  async save(decision: Decision): Promise<void> {
    const existing = this.items.get(decision.id);
    // Sem await entre a leitura e a escrita: duas transições no mesmo
    // processo não podem cada uma gravar por cima da outra.
    if (existing && !continuesDecision(existing, decision)) {
      throw new DecisionOverwriteError(decision.id);
    }
    this.items.set(decision.id, decision);
  }
  async get(id: DecisionId): Promise<Decision | undefined> {
    return this.items.get(id);
  }
  async list(workspaceId: WorkspaceId): Promise<readonly Decision[]> {
    return [...this.items.values()].filter((d) => d.workspaceId === workspaceId);
  }
}
