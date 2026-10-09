/**
 * SENTINEL — a camada que fica ACIMA do agente.
 *
 * O Sentinel não é um conselheiro: é um veto. Ele roda depois da validação
 * determinística e antes de qualquer mutação no provedor, e nenhum modelo de
 * linguagem pode desativá-lo, contorná-lo ou convencê-lo — ele não recebe
 * texto, recebe números e devolve permitido/bloqueado.
 *
 * Por que existe separado do Capital Guard: o Guard responde "cabe no
 * envelope?". O Sentinel responde "isso é seguro AGORA?" — dados velhos,
 * salto grande demais, ação repetida, resfriamento não cumprido. São perguntas
 * diferentes, e juntá-las esconderia a razão real de um bloqueio.
 */
import type { Clock, Money, WorkspaceId } from "@forge/domain";

export type SentinelCode =
  | "STALE_DATA"
  | "STEP_TOO_LARGE"
  | "COOLDOWN_ACTIVE"
  | "DUPLICATE_ACTION"
  | "KILL_SWITCH"
  | "SAFE_MODE"
  | "DAILY_ACTION_LIMIT"
  | "CAPITAL_SHARE_TOO_HIGH"
  | "CURRENCY_MISMATCH";

export interface SentinelVerdict {
  readonly allowed: boolean;
  readonly violations: readonly {
    readonly code: SentinelCode;
    readonly detail: string;
  }[];
}

export interface SentinelPolicy {
  /** Idade máxima aceitável das métricas que embasam a decisão. */
  readonly maxDataAgeMinutes: number;
  /** Aumento máximo por ação, como fração do valor atual (0.2 = +20%). */
  readonly maxIncreaseRatio: number;
  /** Espera mínima entre duas ações no mesmo alvo. */
  readonly cooldownMinutes: number;
  /** Teto de ações por dia por workspace — trava cascata de mudanças. */
  readonly maxActionsPerDay: number;
  /** Fração máxima do capital autorizado que uma única ação pode mover. */
  readonly maxCapitalShare: number;
}

export const DEFAULT_POLICY: SentinelPolicy = {
  maxDataAgeMinutes: 180,
  maxIncreaseRatio: 0.25,
  cooldownMinutes: 60,
  maxActionsPerDay: 24,
  maxCapitalShare: 0.3,
};

export interface SentinelState {
  readonly killSwitch: boolean;
  readonly safeMode: boolean;
}

export interface ActionContext {
  readonly workspaceId: WorkspaceId;
  readonly targetId: string;
  /** Quando as métricas que embasam a decisão foram coletadas. */
  readonly dataObservedAt: Date;
  /** Valor atual do orçamento do alvo (para medir o tamanho do salto). */
  readonly currentValue?: Money;
  /** Valor proposto. */
  readonly proposedValue?: Money;
  readonly capitalAtRisk: Money;
  readonly authorizedCapital: Money;
  /** Chave estável da ação — repetição indica duplicata. */
  readonly fingerprint: string;
}

export interface ActionHistory {
  lastActionAt(
    workspaceId: WorkspaceId,
    targetId: string,
  ): Promise<Date | undefined>;
  actionsToday(workspaceId: WorkspaceId, now: Date): Promise<number>;
  seenFingerprint(
    workspaceId: WorkspaceId,
    fingerprint: string,
  ): Promise<boolean>;
}

export class Sentinel {
  constructor(
    private readonly clock: Clock,
    private readonly history: ActionHistory,
    private readonly policy: SentinelPolicy = DEFAULT_POLICY,
  ) {}

  /**
   * Avalia uma ação. Retorna TODAS as violações, não só a primeira — quem
   * lê o veredito precisa saber tudo que está errado para corrigir de uma vez.
   */
  async evaluate(
    ctx: ActionContext,
    state: SentinelState,
  ): Promise<SentinelVerdict> {
    const violations: { code: SentinelCode; detail: string }[] = [];
    const now = this.clock.now();

    if (state.killSwitch) {
      violations.push({
        code: "KILL_SWITCH",
        detail:
          "Kill switch acionado pelo operador — leitura e aprendizado " +
          "continuam, nenhuma mutação externa é permitida",
      });
    }

    if (state.safeMode) {
      violations.push({
        code: "SAFE_MODE",
        detail:
          "Modo seguro ativo (dado crítico indisponível) — escalonamento " +
          "automático suspenso",
      });
    }

    const ageMinutes = (now.getTime() - ctx.dataObservedAt.getTime()) / 60_000;
    if (ageMinutes > this.policy.maxDataAgeMinutes) {
      violations.push({
        code: "STALE_DATA",
        detail:
          `Métricas com ${Math.round(ageMinutes)} min de idade, acima do ` +
          `limite de ${this.policy.maxDataAgeMinutes} min — decidir sobre ` +
          "dado velho é decidir sobre outra realidade",
      });
    }

    if (ctx.currentValue && ctx.proposedValue) {
      const current = ctx.currentValue;
      const proposed = ctx.proposedValue;
      // `gt` lança CurrencyMismatchError. O Sentinel é um veto: moeda
      // trocada entra na lista e a avaliação segue, não explode.
      if (current.currency !== proposed.currency) {
        violations.push({
          code: "CURRENCY_MISMATCH",
          detail:
            `Valor atual em ${current.currency} e valor proposto em ` +
            `${proposed.currency} — o tamanho do passo não compara moedas ` +
            "diferentes",
        });
      } else if (current.isPositive() && proposed.gt(current)) {
        const ratio = (proposed.minor - current.minor) / current.minor;
        if (ratio > this.policy.maxIncreaseRatio) {
          violations.push({
            code: "STEP_TOO_LARGE",
            detail:
              `Aumento de ${(ratio * 100).toFixed(0)}% excede o passo ` +
              `máximo de ${(this.policy.maxIncreaseRatio * 100).toFixed(0)}% ` +
              "— escalonamento é gradual, com janela de observação entre passos",
          });
        }
      }
    }

    if (ctx.capitalAtRisk.currency !== ctx.authorizedCapital.currency) {
      // A razão dos centavos (500 BRL / 1000 USD) não é uma fração do
      // envelope: são moedas diferentes. Não dividir.
      violations.push({
        code: "CURRENCY_MISMATCH",
        detail:
          `Capital em risco em ${ctx.capitalAtRisk.currency} e capital ` +
          `autorizado em ${ctx.authorizedCapital.currency} — a fração do ` +
          "envelope só existe dentro da mesma moeda",
      });
    } else if (ctx.authorizedCapital.isPositive()) {
      const share = ctx.capitalAtRisk.minor / ctx.authorizedCapital.minor;
      if (share > this.policy.maxCapitalShare) {
        violations.push({
          code: "CAPITAL_SHARE_TOO_HIGH",
          detail:
            `Ação move ${(share * 100).toFixed(0)}% do capital autorizado, ` +
            `acima do teto de ${(this.policy.maxCapitalShare * 100).toFixed(0)}%`,
        });
      }
    }

    const last = await this.history.lastActionAt(ctx.workspaceId, ctx.targetId);
    if (last) {
      const sinceMinutes = (now.getTime() - last.getTime()) / 60_000;
      if (sinceMinutes < this.policy.cooldownMinutes) {
        violations.push({
          code: "COOLDOWN_ACTIVE",
          detail:
            `Última ação neste alvo há ${Math.round(sinceMinutes)} min; ` +
            `o resfriamento é de ${this.policy.cooldownMinutes} min — sem ` +
            "essa janela não dá para saber se a mudança anterior funcionou",
        });
      }
    }

    if (await this.history.seenFingerprint(ctx.workspaceId, ctx.fingerprint)) {
      violations.push({
        code: "DUPLICATE_ACTION",
        detail:
          `Ação idêntica já registrada (${ctx.fingerprint}) — repetir ` +
          "duplicaria a exposição sem nova evidência",
      });
    }

    const today = await this.history.actionsToday(ctx.workspaceId, now);
    if (today >= this.policy.maxActionsPerDay) {
      violations.push({
        code: "DAILY_ACTION_LIMIT",
        detail:
          `${today} ações hoje, no limite de ${this.policy.maxActionsPerDay} ` +
          "— cascata de mudanças impede medir o efeito de cada uma",
      });
    }

    return { allowed: violations.length === 0, violations };
  }
}

export class InMemoryActionHistory implements ActionHistory {
  private readonly last = new Map<string, Date>();
  private readonly fingerprints = new Set<string>();
  private readonly byDay = new Map<string, number>();

  async lastActionAt(
    workspaceId: WorkspaceId,
    targetId: string,
  ): Promise<Date | undefined> {
    return this.last.get(`${workspaceId}::${targetId}`);
  }

  async actionsToday(workspaceId: WorkspaceId, now: Date): Promise<number> {
    return this.byDay.get(this.dayKey(workspaceId, now)) ?? 0;
  }

  async seenFingerprint(
    workspaceId: WorkspaceId,
    fingerprint: string,
  ): Promise<boolean> {
    return this.fingerprints.has(`${workspaceId}::${fingerprint}`);
  }

  /** Chamado depois que a ação é efetivamente executada. */
  record(
    workspaceId: WorkspaceId,
    targetId: string,
    fingerprint: string,
    at: Date,
  ): void {
    this.last.set(`${workspaceId}::${targetId}`, at);
    this.fingerprints.add(`${workspaceId}::${fingerprint}`);
    const key = this.dayKey(workspaceId, at);
    this.byDay.set(key, (this.byDay.get(key) ?? 0) + 1);
  }

  private dayKey(workspaceId: WorkspaceId, at: Date): string {
    return `${workspaceId}::${at.toISOString().slice(0, 10)}`;
  }
}
