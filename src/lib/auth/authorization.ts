const ADMIN_ONLY_ROUTE_PREFIXES = ["/permissoes"] as const;

const ROUTE_PAGE_KEYS: ReadonlyArray<{ prefix: string; pageKey: string }> = [
  { prefix: "/home", pageKey: "home" },
  { prefix: "/estoque", pageKey: "estoque" },
  { prefix: "/entrada", pageKey: "entrada" },
  { prefix: "/saida", pageKey: "saida" },
  { prefix: "/materiais", pageKey: "materiais" },
  { prefix: "/pessoas", pageKey: "pessoas" },
  { prefix: "/cadastro-base", pageKey: "cadastro-base" },
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

  if (normalized === "master" || normalized === "admin") {
    return ["home", "estoque", "entrada", "saida", "materiais", "pessoas", "cadastro-base"];
  }

  if (normalized === "supervisor") {
    return ["home", "estoque", "entrada", "saida", "materiais", "pessoas"];
  }

  if (normalized === "viewer") {
    return ["home", "estoque"];
  }

  return ["home", "estoque", "entrada", "saida", "materiais", "pessoas"];
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
