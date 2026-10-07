/**
 * `Money` é a base de todo o Capital Guard. Se a aritmética aqui estiver
 * errada, todas as garantias acima dela são falsas.
 */
import { describe, expect, it } from "vitest";
import {
  CurrencyMismatchError,
  InvalidMoneyError,
  Money,
  sumMoney,
} from "../src/index.js";

describe("precisão", () => {
  it("não sofre o erro clássico de ponto flutuante", () => {
    const a = Money.fromMajor(0.1, "BRL");
    const b = Money.fromMajor(0.2, "BRL");
    expect(a.plus(b).toMajor()).toBe(0.3);
    expect(a.plus(b).minor).toBe(30);
    // a mesma conta em float falha
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("converte pela representação decimal e recusa o que não cabe em centavos", () => {
    // `1.005 * 100` em float é 100.4999…; Math.round perdia o centavo (100).
    // Mais casas do que a moeda permite são recusadas — não arredondadas.
    expect(() => Money.fromMajor(1.005, "BRL")).toThrow(InvalidMoneyError);
    expect(() => Money.fromMajor(-1.005, "BRL")).toThrow(InvalidMoneyError);
    // `0.1 + 0.2` chega como 0.30000000000000004, que não é um centavo exato.
    expect(() => Money.fromMajor(0.1 + 0.2, "BRL")).toThrow(InvalidMoneyError);
    expect(Money.fromMajor(-19.99, "USD").minor).toBe(-1999);

    // Valor grande em que `major * 100` cai no centavo vizinho.
    const large = 90071992547409.9;
    expect(Math.round(large * 100)).toBe(9007199254740991);
    expect(Money.fromMajor(large, "BRL").minor).toBe(9007199254740990);
    expect(Money.fromMajor(9007199254740.99, "EUR").minor).toBe(
      900719925474099,
    );
  });

  it("mil somas de um centavo dão exatamente dez reais", () => {
    let total = Money.zero("BRL");
    for (let i = 0; i < 1000; i++) {
      total = total.plus(Money.fromMinor(1, "BRL"));
    }
    expect(total.toMajor()).toBe(10);
    expect(total.minor).toBe(1000);
  });

  it("percentual arredonda de forma explícita, sem acumular resíduo", () => {
    const budget = Money.fromMajor(33.33, "BRL");
    const tenPercent = budget.times(0.1);
    expect(tenPercent.minor).toBe(333); // 3333 * 0.1 = 333.3 → 333
    expect(tenPercent.toMajor()).toBe(3.33);
  });
});

describe("invariantes de construção", () => {
  it("rejeita centavos fracionários", () => {
    expect(() => Money.fromMinor(10.5, "BRL")).toThrow(InvalidMoneyError);
  });

  it("rejeita valor não numérico", () => {
    expect(() => Money.fromMajor(Number.NaN, "BRL")).toThrow(InvalidMoneyError);
    expect(() => Money.fromMajor(Number.POSITIVE_INFINITY, "BRL")).toThrow(
      InvalidMoneyError,
    );
  });

  it("rejeita valor fora do intervalo inteiro seguro", () => {
    expect(() => Money.fromMinor(Number.MAX_SAFE_INTEGER + 2, "BRL")).toThrow(
      InvalidMoneyError,
    );
  });

  it("aceita negativo (saldo pode ficar negativo após revogação)", () => {
    expect(Money.fromMinor(-500, "BRL").isNegative()).toBe(true);
  });
});

describe("moeda", () => {
  it("somar moedas diferentes é erro, não conversão silenciosa", () => {
    const brl = Money.fromMajor(10, "BRL");
    const usd = Money.fromMajor(10, "USD");
    expect(() => brl.plus(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.minus(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.gt(usd)).toThrow(CurrencyMismatchError);
  });

  it("igualdade considera a moeda", () => {
    expect(Money.fromMajor(10, "BRL").equals(Money.fromMajor(10, "USD"))).toBe(
      false,
    );
    expect(Money.fromMajor(10, "BRL").equals(Money.fromMajor(10, "BRL"))).toBe(
      true,
    );
  });
});

describe("comparação", () => {
  it("ordena por valor", () => {
    const a = Money.fromMajor(10, "BRL");
    const b = Money.fromMajor(20, "BRL");
    expect(b.gt(a)).toBe(true);
    expect(a.lt(b)).toBe(true);
    expect(a.gte(a)).toBe(true);
    expect(a.gt(a)).toBe(false);
  });

  it("classifica sinal corretamente", () => {
    expect(Money.zero("BRL").isZero()).toBe(true);
    expect(Money.fromMinor(1, "BRL").isPositive()).toBe(true);
    expect(Money.fromMinor(-1, "BRL").isNegative()).toBe(true);
  });
});

describe("serialização", () => {
  it("toString mostra moeda e duas casas", () => {
    expect(Money.fromMajor(1234.5, "BRL").toString()).toBe("BRL 1234.50");
  });

  it("toJSON preserva os centavos, não o float", () => {
    expect(Money.fromMajor(19.99, "USD").toJSON()).toEqual({
      minor: 1999,
      currency: "USD",
    });
  });
});

describe("sumMoney", () => {
  it("soma lista vazia como zero da moeda", () => {
    expect(sumMoney([], "BRL").isZero()).toBe(true);
  });

  it("soma preservando precisão", () => {
    const items = [0.1, 0.2, 0.3].map((v) => Money.fromMajor(v, "BRL"));
    expect(sumMoney(items, "BRL").toMajor()).toBe(0.6);
  });
});
