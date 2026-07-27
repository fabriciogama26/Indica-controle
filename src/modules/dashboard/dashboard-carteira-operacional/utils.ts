export function formatPortfolioCurrency(value: number, compact = false) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatPortfolioPercent(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

export function formatPortfolioNumber(value: number, digits = 0) {
  return (Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function maxPortfolioValue(values: number[]) {
  return Math.max(1, ...values.map((value) => Number(value) || 0));
}

export function portfolioStatusLabel(status: "CONCLUIDO" | "PENDENTE") {
  return status === "CONCLUIDO" ? "Concluido" : "Pendente";
}

export function portfolioOriginLabel(origin: "NOVO" | "HERDADO" | "SEM_PRODUCAO") {
  if (origin === "NOVO") return "Novo";
  if (origin === "HERDADO") return "Herdado";
  return "Sem producao";
}

export function portfolioScopeLabel(scope: "ATIVA" | "RETIRADA") {
  return scope === "RETIRADA" ? "Retirada" : "Ativa";
}
