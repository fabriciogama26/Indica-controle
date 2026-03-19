const ADMIN_ONLY_ROUTE_PREFIXES = ["/permissoes"] as const;

const ROUTE_PAGE_KEYS: ReadonlyArray<{ prefix: string; pageKey: string }> = [
  { prefix: "/home", pageKey: "home" },
  { prefix: "/projetos", pageKey: "projetos" },
  { prefix: "/locacao", pageKey: "locacao" },
  { prefix: "/programacao-simples", pageKey: "programacao-simples" },
  { prefix: "/programacao", pageKey: "programacao-simples" },
  { prefix: "/medicao", pageKey: "medicao" },
  { prefix: "/estoque", pageKey: "estoque" },
  { prefix: "/entrada", pageKey: "entrada" },
  { prefix: "/saida", pageKey: "saida" },
  { prefix: "/materiais", pageKey: "materiais" },
  { prefix: "/pessoas", pageKey: "pessoas" },
  { prefix: "/cargo", pageKey: "cargo" },
  { prefix: "/equipes", pageKey: "equipes" },
  { prefix: "/prioridade", pageKey: "prioridade" },
  { prefix: "/centro-servico", pageKey: "centro-servico" },
  { prefix: "/contrato", pageKey: "contrato" },
  { prefix: "/atividades", pageKey: "atividades" },
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
  return normalized === "admin" || normalized === "master";
}

export function resolveDefaultPageAccess(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  const defaultPageAccess = [
    "home",
    "projetos",
    "locacao",
    "programacao-simples",
    "medicao",
    "estoque",
    "entrada",
    "saida",
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
  ];

  if (normalized === "master" || normalized === "admin") {
    return defaultPageAccess;
  }

  if (normalized === "supervisor") {
    return defaultPageAccess;
  }

  if (normalized === "viewer") {
    return ["home", "estoque"];
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
