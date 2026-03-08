"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PropsWithChildren, useEffect, useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import { canAccessRoute, isAdminRole, normalizeRole } from "@/lib/auth/authorization";
import styles from "./AppShell.module.css";

const menuSections = [
  {
    title: "Visao Geral",
    items: [{ href: "/home", label: "Dashboard Estoque", icon: "home" }],
  },
  {
    title: "Operacao",
    items: [
      { href: "/estoque", label: "Estoque Atual", icon: "box" },
      { href: "/entrada", label: "Entradas", icon: "arrow-down" },
      { href: "/saida", label: "Saidas", icon: "arrow-up" },
    ],
  },
  {
    title: "Cadastros",
    items: [
      { href: "/pessoas", label: "Pessoas", icon: "users" },
      { href: "/materiais", label: "Materiais", icon: "package" },
      { href: "/cadastro-base", label: "Cadastro Base", icon: "settings" },
    ],
  },
] as const;

const titleMap: Record<string, { title: string; subtitle: string }> = {
  "/home": {
    title: "Home",
    subtitle: "Resumo inicial do tenant e atalhos principais.",
  },
  "/cadastro-base": {
    title: "Cadastro Base",
    subtitle: "Ponto de entrada para os cadastros do SaaS.",
  },
  "/pessoas": {
    title: "Pessoas",
    subtitle: "Cadastro e consulta de pessoas operacionais.",
  },
  "/materiais": {
    title: "Materiais",
    subtitle: "Cadastro e manutencao do catalogo de materiais.",
  },
  "/entrada": {
    title: "Entrada",
    subtitle: "Lancamentos de entrada no estoque fisico.",
  },
  "/saida": {
    title: "Saida",
    subtitle: "Lancamentos de saida do estoque fisico.",
  },
  "/estoque": {
    title: "Estoque Atual",
    subtitle: "Consulta de saldo fisico consolidado.",
  },
  "/permissoes": {
    title: "Permissoes",
    subtitle: "Base inicial para a futura matriz de acesso por pagina.",
  },
};

function renderMenuIcon(icon: (typeof menuSections)[number]["items"][number]["icon"]) {
  switch (icon) {
    case "home":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4.75 10.25 12 4.75l7.25 5.5v8a1 1 0 0 1-1 1h-4.5V13.5h-3.5v5.75h-4.5a1 1 0 0 1-1-1v-8Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "box":
    case "package":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3.75 5 7.25v9.5L12 20.25l7-3.5v-9.5l-7-3.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M5.25 7.5 12 11l6.75-3.5M12 11v9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 5.5v13m0 0-4.5-4.5M12 18.5l4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "arrow-up":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 18.5v-13m0 0-4.5 4.5M12 5.5l4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "users":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15.75 18.25v-1c0-1.52-1.68-2.75-3.75-2.75s-3.75 1.23-3.75 2.75v1M12 12a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 12 12ZM18 18.25v-.75c0-1.15-.74-2.14-1.8-2.56M16.5 6.91A2.75 2.75 0 0 1 16.5 12.09M6 18.25v-.75c0-1.15.74-2.14 1.8-2.56M7.5 6.91A2.75 2.75 0 0 0 7.5 12.09"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

export function AppShell({ children }: PropsWithChildren) {
  const { session, isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const normalizedRole = normalizeRole(session?.user.role);
  const isAdmin = isAdminRole(normalizedRole);
  const routeAccessContext = useMemo(
    () => ({
      role: session?.user.role,
      pageAccess: session?.user.pageAccess,
      hasCustomPermissions: session?.user.hasCustomPermissions,
    }),
    [session?.user.hasCustomPermissions, session?.user.pageAccess, session?.user.role],
  );
  const canAccessCurrentRoute = canAccessRoute(routeAccessContext, pathname);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  const header = useMemo(() => {
    if (!pathname) {
      return titleMap["/home"];
    }

    const match = Object.entries(titleMap).find(([route]) => pathname.startsWith(route));
    return match ? match[1] : titleMap["/home"];
  }, [pathname]);

  const visibleSections = useMemo(
    () =>
      menuSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => canAccessRoute(routeAccessContext, item.href)),
        }))
        .filter((section) => section.items.length > 0),
    [routeAccessContext],
  );

  const fallbackRoute = useMemo(() => {
    const firstVisibleItem = visibleSections.flatMap((section) => section.items)[0];
    return firstVisibleItem?.href ?? null;
  }, [visibleSections]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && !canAccessCurrentRoute) {
      router.replace(fallbackRoute ?? "/login");
    }
  }, [canAccessCurrentRoute, fallbackRoute, isAuthenticated, isLoading, router]);

  if (isLoading || !session) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.loadingCard}>Carregando sessao...</div>
      </div>
    );
  }

  const displayName = session.user.displayName?.trim() || session.user.loginName || "Usuario";
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logoBlock}>
          <Image
            src="/indica.png"
            alt="INDICA - SERVICOS"
            width={144}
            height={144}
            className={styles.logoImage}
            priority
          />
        </div>

        <nav className={styles.nav}>
          {visibleSections.map((section) => (
            <div key={section.title} className={styles.navSection}>
              <div className={styles.sectionTitle}>{section.title}</div>

              <div className={styles.sectionItems}>
                {section.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link key={item.href} href={item.href} className={isActive ? styles.navItemActive : styles.navItem}>
                      <span className={styles.navIcon}>{renderMenuIcon(item.icon)}</span>
                      <span className={styles.navLabel}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className={styles.contentArea}>
        <header className={styles.topbar}>
          <div className={styles.pageHeading}>
            <div className={styles.topbarTitle}>{header.title}</div>
            <div className={styles.topbarSubtitle}>{header.subtitle}</div>
          </div>

          <div className={styles.userPanel}>
            <div className={styles.connectionStatus}>
              <span className={styles.statusDot} aria-hidden="true" />
              <span>Conectado</span>
            </div>

            <div className={styles.userIdentity}>
              <span className={styles.userName}>{displayName}</span>
              <span className={styles.userMeta}>
                Tenant: {session.user.tenantId} | Perfil: {normalizedRole || "sem role"}
              </span>
            </div>

            <div className={styles.headerActions}>
              {isAdmin ? (
                <Link
                  href="/permissoes"
                  className={pathname === "/permissoes" ? styles.settingsLinkActive : styles.settingsLink}
                  aria-label="Abrir configuracoes de permissoes"
                  title="Permissoes"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className={styles.settingsIcon}
                    aria-hidden="true"
                  >
                    <path
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              ) : null}

              <button
                type="button"
                className={styles.logoutButton}
                onClick={() => logout().then(() => router.replace("/login"))}
              >
                Sair
              </button>
            </div>
          </div>
        </header>

        <main className={styles.mainContent}>{children}</main>
      </div>
    </div>
  );
}
