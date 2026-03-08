"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { canAccessRoute, isAdminRole, normalizeRole } from "@/lib/auth/authorization";
import styles from "./AppShell.module.css";

const menuSections = [
  {
    title: "Visao Geral",
    items: [{ href: "/home", label: "Dashboard Estoque" }],
  },
  {
    title: "Operacao",
    items: [
      { href: "/estoque", label: "Estoque Atual" },
      { href: "/entrada", label: "Entradas" },
      { href: "/saida", label: "Saidas" },
    ],
  },
  {
    title: "Cadastros",
    items: [
      { href: "/pessoas", label: "Pessoas" },
      { href: "/materiais", label: "Materiais" },
      { href: "/cadastro-base", label: "Cadastro Base" },
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

export function AppShell({ children }: PropsWithChildren) {
  const { session, isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    "Visao Geral": true,
    Operacao: true,
    Cadastros: true,
  });

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

  function toggleSection(title: string) {
    setOpenSections((current) => ({
      ...current,
      [title]: !current[title],
    }));
  }

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
              <button
                type="button"
                className={styles.sectionToggle}
                onClick={() => toggleSection(section.title)}
                aria-expanded={openSections[section.title]}
              >
                <span className={styles.sectionTitle}>{section.title}</span>
                <span className={styles.sectionCaret}>{openSections[section.title] ? "-" : "+"}</span>
              </button>

              {openSections[section.title] ? (
                <div className={styles.sectionItems}>
                  {section.items.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <Link key={item.href} href={item.href} className={isActive ? styles.navItemActive : styles.navItem}>
                        <span className={styles.navLabel}>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
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
