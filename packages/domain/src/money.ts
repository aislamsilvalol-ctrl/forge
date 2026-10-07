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
   * Aceita a unidade maior (reais) só na BORDA — entrada do usuário,
   * resposta de API. A conversão lê a representação decimal do número
   * (a string de ida e volta), nunca `major * 100`: essa multiplicação
   * em float perde um centavo em `1.005` e erra um centavo em valores
   * grandes (ex.: `90071992547409.9`).
   *
   * BRL, USD e EUR têm 2 casas. Mais casas são RECUSADAS, não
   * arredondadas: arredondar inventaria ou perderia um centavo sem o
   * chamador saber. `fromMajor(0.1 + 0.2)` carrega o resíduo do float
   * e é recusado; some valores já convertidos.
   */
  static fromMajor(major: number, currency: Currency): Money {
    if (!Number.isFinite(major)) {
      throw new InvalidMoneyError(`Valor não numérico: ${major}`);
    }
    return Money.fromMinor(minorUnitsFromMajor(major), currency);
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

/**
 * Casas da unidade menor. As três moedas do domínio usam centavos; se
 * entrar uma moeda com outra escala, a conversão deixa de ser um único
 * número.
 */
const MINOR_DECIMALS = 2;

/**
 * Centavos exatos a partir da representação decimal. Não multiplica por
 * 100 em float: o inteiro é montado com os dígitos da string.
 */
function minorUnitsFromMajor(major: number): number {
  const text = Object.is(major, -0) ? "0" : major.toString();
  const decimal = expandPlainDecimal(text);
  const negative = decimal.startsWith("-");
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole, frac = ""] = unsigned.split(".");
  if (
    whole === undefined ||
    !/^\d+$/.test(whole) ||
    (frac !== "" && !/^\d+$/.test(frac))
  ) {
    throw new InvalidMoneyError(`Valor decimal ilegível: ${text}`);
  }
  if (frac.length > MINOR_DECIMALS) {
    throw new InvalidMoneyError(
      `Valor ${text} tem ${frac.length} casas decimais; a moeda aceita no máximo ${MINOR_DECIMALS}. ` +
        `Recusado para não perder nem inventar centavo`,
    );
  }
  const digits = `${whole}${frac.padEnd(MINOR_DECIMALS, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  const minor = BigInt(`${negative ? "-" : ""}${digits}`);
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (minor > max || minor < -max) {
    throw new InvalidMoneyError(`Valor fora do intervalo seguro: ${text}`);
  }
  return Number(minor);
}

/** Tira a notação científica para contar casas decimais de verdade. */
function expandPlainDecimal(text: string): string {
  if (!/[eE]/.test(text)) return text;
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) {
    throw new InvalidMoneyError(`Valor decimal ilegível: ${text}`);
  }
  const sign = match[1] ?? "";
  const intPart = match[2];
  const fracPart = match[3] ?? "";
  const expText = match[4];
  if (intPart === undefined || expText === undefined) {
    throw new InvalidMoneyError(`Valor decimal ilegível: ${text}`);
  }
  const exp = Number(expText);
  if (!Number.isInteger(exp)) {
    throw new InvalidMoneyError(`Valor decimal ilegível: ${text}`);
  }
  const digits = `${intPart}${fracPart}`;
  const point = intPart.length + exp;
  if (point >= digits.length) {
    return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  }
  if (point > 0) {
    return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return `${sign}0.${"0".repeat(-point)}${digits}`;
}
