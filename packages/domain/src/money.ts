/**
 * Dinheiro em unidades MENORES inteiras (centavos), nunca ponto flutuante.
 *
 * Por que isso existe: `0.1 + 0.2 !== 0.3` em IEEE-754. Num motor que
 * autoriza gasto real de anúncio, um centavo de erro acumulado por operação
 * vira divergência com a fatura do provedor — e um Capital Guard que não
 * bate com o extrato não protege ninguém. Toda aritmética aqui é sobre
 * inteiros; a conversão para exibição acontece só na borda.
 */

export type Currency = "BRL" | "USD" | "EUR";

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Moedas diferentes na mesma operação: ${a} e ${b}`);
    this.name = "CurrencyMismatchError";
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

export class Money {
  /** @param minor valor em centavos (inteiro, pode ser negativo) */
  private constructor(
    readonly minor: number,
    readonly currency: Currency,
  ) {}

  static fromMinor(minor: number, currency: Currency): Money {
    if (!Number.isInteger(minor)) {
      throw new InvalidMoneyError(
        `Valor em centavos precisa ser inteiro, recebido ${minor}`,
      );
    }
    if (!Number.isSafeInteger(minor)) {
      throw new InvalidMoneyError(`Valor fora do intervalo seguro: ${minor}`);
    }
    return new Money(minor, currency);
  }

  /**
   * Aceita a unidade maior (reais) apenas na BORDA do sistema — entrada do
   * usuário, resposta de API. Arredonda meio-para-cima de forma explícita
   * para que o erro seja auditável em vez de depender do modo do float.
   */
  static fromMajor(major: number, currency: Currency): Money {
    if (!Number.isFinite(major)) {
      throw new InvalidMoneyError(`Valor não numérico: ${major}`);
    }
    return Money.fromMinor(Math.round(major * 100), currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0, currency);
  }

  private assertSame(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  plus(other: Money): Money {
    this.assertSame(other);
    return Money.fromMinor(this.minor + other.minor, this.currency);
  }

  minus(other: Money): Money {
    this.assertSame(other);
    return Money.fromMinor(this.minor - other.minor, this.currency);
  }

  /** Multiplicação por fator adimensional (percentuais, pesos de alocação). */
  times(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw new InvalidMoneyError(`Fator inválido: ${factor}`);
    }
    return Money.fromMinor(Math.round(this.minor * factor), this.currency);
  }

  isNegative(): boolean {
    return this.minor < 0;
  }

  isZero(): boolean {
    return this.minor === 0;
  }

  isPositive(): boolean {
    return this.minor > 0;
  }

  gt(other: Money): boolean {
    this.assertSame(other);
    return this.minor > other.minor;
  }

  gte(other: Money): boolean {
    this.assertSame(other);
    return this.minor >= other.minor;
  }

  lt(other: Money): boolean {
    this.assertSame(other);
    return this.minor < other.minor;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  /** Valor em unidade maior — só para exibição/serialização, nunca para contas. */
  toMajor(): number {
    return this.minor / 100;
  }

  toString(): string {
    return `${this.currency} ${this.toMajor().toFixed(2)}`;
  }

  toJSON(): { minor: number; currency: Currency } {
    return { minor: this.minor, currency: this.currency };
  }
}

export const sumMoney = (items: readonly Money[], currency: Currency): Money =>
  items.reduce((acc, m) => acc.plus(m), Money.zero(currency));
