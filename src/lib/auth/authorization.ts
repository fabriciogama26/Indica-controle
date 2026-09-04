const ADMIN_ONLY_ROUTE_PREFIXES = ["/permissoes"] as const;

const ROUTE_PAGE_KEYS: ReadonlyArray<{ prefix: string; pageKey: string }> = [
  { prefix: "/home", pageKey: "home" },
  { prefix: "/dash-estoque", pageKey: "dash-estoque" },
  { prefix: "/dashboard-medicao", pageKey: "dashboard-medicao" },
  { prefix: "/dashboard-equipes", pageKey: "dashboard-equipes" },
  { prefix: "/dashboard-carteira-operacional", pageKey: "dashboard-carteira-operacional" },
  { prefix: "/dash-operacional-faturamento", pageKey: "dash-operacional-faturamento" },
  { prefix: "/projetos", pageKey: "projetos" },
  { prefix: "/cronograma-solicitacoes", pageKey: "cronograma-solicitacoes" },
  { prefix: "/locacao", pageKey: "locacao" },
  { prefix: "/programacao-normalizada", pageKey: "programacao-normalizada" },
  { prefix: "/programacao-visualizacao", pageKey: "programacao-visualizacao" },
  { prefix: "/mapa-programacao", pageKey: "mapa-programacao" },
  // C6 do corte: `/programacao` redireciona para a Normalizada, entao a chave de
  // permissao acompanhou. Nao ha risco de capturar `/programacao-visualizacao`:
  // `resolvePageKeyFromPath` casa por igualdade exata ou por `prefixo + "/"`,
  // nunca por prefixo solto.
  { prefix: "/programacao", pageKey: "programacao-normalizada" },
  { prefix: "/composicao-equipe", pageKey: "composicao-equipe" },
  { prefix: "/controle-apr", pageKey: "controle-apr" },
  { prefix: "/apuracao-fator-minimo", pageKey: "apuracao-fator-minimo" },
  { prefix: "/medicao-asbuilt", pageKey: "medicao-asbuilt" },
  { prefix: "/medicao-comercial", pageKey: "medicao-comercial" },
  { prefix: "/medicao-visualizacao", pageKey: "medicao-visualizacao" },
  { prefix: "/medicao", pageKey: "medicao" },
  { prefix: "/faturamento", pageKey: "faturamento" },
  { prefix: "/meta", pageKey: "meta" },
  { prefix: "/estoque", pageKey: "estoque" },
  { prefix: "/estoque-equipes", pageKey: "estoque-equipes" },
  { prefix: "/mapa-almoxarifado", pageKey: "mapa-almoxarifado" },
  { prefix: "/posicao-trafo", pageKey: "posicao-trafo" },
  { prefix: "/entrada", pageKey: "entrada" },
  { prefix: "/saida", pageKey: "saida" },
  { prefix: "/requisicao-solicitacao", pageKey: "requisicao-solicitacao" },
  { prefix: "/requisicao-atendimento", pageKey: "requisicao-atendimento" },
  { prefix: "/estorno-atendimento", pageKey: "estorno-atendimento" },
  { prefix: "/estornos", pageKey: "estornos" },
  { prefix: "/consumo-projeto", pageKey: "consumo-projeto" },
  { prefix: "/materiais", pageKey: "materiais" },
  { prefix: "/pessoas", pageKey: "pessoas" },
  { prefix: "/cargo", pageKey: "cargo" },
  { prefix: "/equipes", pageKey: "equipes" },
  { prefix: "/configuracao-mapa-almoxarifado", pageKey: "configuracao-mapa-almoxarifado" },
  { prefix: "/prioridade", pageKey: "prioridade" },
  { prefix: "/centro-servico", pageKey: "centro-servico" },
  { prefix: "/centro-estoque", pageKey: "centro-estoque" },
  { prefix: "/contrato", pageKey: "contrato" },
  { prefix: "/atividades", pageKey: "atividades" },
  { prefix: "/categoria-atividade", pageKey: "categoria-atividade" },
  { prefix: "/grupo-atividade", pageKey: "grupo-atividade" },
  { prefix: "/motivo-sem-producao", pageKey: "motivo-sem-producao" },
  { prefix: "/tipo-equipe", pageKey: "tipo-equipe" },
  { prefix: "/imei", pageKey: "imei" },
  { prefix: "/tipo-servico", pageKey: "tipo-servico" },
  { prefix: "/nivel-tensao", pageKey: "nivel-tensao" },
  { prefix: "/porte", pageKey: "porte" },
  { prefix: "/responsavel-distribuidora", pageKey: "responsavel-distribuidora" },
  { prefix: "/municipio", pageKey: "municipio" },
];

export type RouteAccessContext = {
  role: string | null | undefined;
  pageAccess?: string[] | null;
  hasCustomPermissions?: boolean | null;
};

export function normalizeRole(role: string | null | undefined) {
  return String(role ?? "").trim().toLowerCase();
}

export function isAdminRole(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  return normalized === "admin";
}

// Espelho de `app_pages.default_user_access = true`. NAO e a fonte de verdade — o banco e —,
// mas alimenta o fallback de sessao e a matriz inicial da tela de Permissoes.
//
// REGRA: tela NOVA nunca entra aqui. Ela nasce bloqueada (migration 356 forca
// `default_user_access = false` em todo INSERT de `app_pages`) e so e liberada por concessao
// explicita na tela de Permissoes. Adicionar a chave aqui antes disso concede a tela a todo
// usuario nao administrativo sem nenhum registro em `app_user_permission_history`.
//
// Alteracao permitida nesta lista: REMOVER chave cujo `default_user_access` no banco seja
// `false`. Adicionar chave exige que o banco ja tenha `default_user_access = true` para ela,
// concedido por migration explicita (padrao da migration 348).
export const DEFAULT_USER_PAGE_ACCESS = [
  "home",
  "dash-estoque",
  "dashboard-medicao",
  "dashboard-equipes",
  "dash-operacional-faturamento",
  "projetos",
  "locacao",
  // Liberada no banco pela migration 362 (C3 do corte).
  //
  // `programacao-simples` saiu desta lista no C7 (migration 363 zerou o
  // `default_user_access` dela, condicao que a regra acima exige para remover
  // uma chave daqui) e deixou de existir no C8, que removeu a tela do codigo e
  // aposentou o page_key na migration 364.
  "programacao-normalizada",
  "programacao-visualizacao",
  "composicao-equipe",
  "controle-apr",
  "medicao-asbuilt",
  "medicao",
  "faturamento",
  "meta",
  "estoque",
  "estoque-equipes",
  "posicao-trafo",
  "entrada",
  "saida",
  "estornos",
  "consumo-projeto",
  "materiais",
  "pessoas",
  "cargo",
  "equipes",
  "prioridade",
  "centro-servico",
  "contrato",
  "atividades",
  "tipo-equipe",
  "imei",
  "tipo-servico",
  "nivel-tensao",
  "porte",
  "responsavel-distribuidora",
  "municipio",
] as const;

export const VIEWER_PAGE_ACCESS = [
  "home",
  "dash-estoque",
  "dashboard-medicao",
  "dashboard-equipes",
  "dash-operacional-faturamento",
  "programacao-visualizacao",
  "medicao-visualizacao",
  "estoque",
  "estoque-equipes",
  "posicao-trafo",
  "estornos",
  "consumo-projeto",
] as const;

export function resolveDefaultPageAccess(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  const defaultPageAccess = [...DEFAULT_USER_PAGE_ACCESS];

  if (normalized === "admin") {
    return [...defaultPageAccess, "dashboard-carteira-operacional"];
  }

  if (normalized === "viewer") {
    return [...VIEWER_PAGE_ACCESS];
  }

  return defaultPageAccess;
}

export function normalizePageAccess(pageAccess: string[] | null | undefined) {
  return Array.from(
    new Set(
      (pageAccess ?? [])
        .map((pageKey) => String(pageKey ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function getResolvedPageAccess(context: RouteAccessContext) {
  if (context.hasCustomPermissions) {
    return normalizePageAccess(context.pageAccess);
  }

  return resolveDefaultPageAccess(context.role);
}

export function hasPageAccess(context: RouteAccessContext, pageKey: string | null | undefined) {
  const normalizedPageKey = String(pageKey ?? "").trim().toLowerCase();
  if (!normalizedPageKey) {
    return true;
  }

  return getResolvedPageAccess(context).includes(normalizedPageKey);
}

export function resolvePageKeyFromPath(pathname: string | null | undefined) {
  const currentPath = String(pathname ?? "").trim();
  if (!currentPath) {
    return null;
  }

  const match = ROUTE_PAGE_KEYS.find(
    (route) => currentPath === route.prefix || currentPath.startsWith(`${route.prefix}/`),
  );

  return match?.pageKey ?? null;
}

export function canAccessRoute(context: RouteAccessContext, pathname: string | null | undefined) {
  const currentPath = String(pathname ?? "").trim();
  if (!currentPath) {
    return true;
  }

  const needsAdmin = ADMIN_ONLY_ROUTE_PREFIXES.some(
    (prefix) => currentPath === prefix || currentPath.startsWith(`${prefix}/`),
  );

  if (needsAdmin) {
    return isAdminRole(context.role);
  }

  const pageKey = resolvePageKeyFromPath(currentPath);
  if (!pageKey) {
    return false;
  }

  return hasPageAccess(context, pageKey);
}
