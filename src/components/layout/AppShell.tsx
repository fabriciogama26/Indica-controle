"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PropsWithChildren, useEffect, useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import { canAccessRoute, isAdminRole, normalizeRole } from "@/lib/auth/authorization";
import styles from "./AppShell.module.css";

// Checklist obrigatorio para nova tela:
// 1) Migration com cadastro da pagina em app_pages e backfill de permissoes por tenant.
// 2) Atualizar permissionCatalog em PermissionsPageView.
// 3) Incluir rota nesta estrutura e no titleMap abaixo.
const menuSections = [
  {
    title: "Visao Geral",
    items: [{ href: "/home", label: "Dashboard Estoque", icon: "home" }],
  },
  {
    title: "Operacao",
    items: [
      { href: "/projetos", label: "Projetos", icon: "folder" },
      { href: "/locacao", label: "Locacao", icon: "briefcase" },
      { href: "/programacao-simples", label: "Programacao", icon: "calendar" },
      { href: "/programacao-visualizacao", label: "Visualizacao Programacao", icon: "calendar" },
      { href: "/medicao", label: "Medicao", icon: "calendar" },
    ],
  },
  {
    title: "Almoxarifado",
    items: [
      { href: "/estoque", label: "Estoque Atual", icon: "box" },
      { href: "/entrada", label: "Entrada Estoque", icon: "arrow-down" },
      { href: "/saida", label: "Saida Estoque", icon: "arrow-up" },
    ],
  },
  {
    title: "Cadastros",
    items: [
      { href: "/materiais", label: "Materiais", icon: "package" },
      { href: "/pessoas", label: "Pessoas", icon: "users" },
      { href: "/cargo", label: "Cargo", icon: "settings" },
      { href: "/equipes", label: "Equipes", icon: "users" },
    ],
  },
  {
    title: "Cadastro Base",
    items: [
      { href: "/prioridade", label: "Prioridade", icon: "settings" },
      { href: "/centro-servico", label: "Centro de Servico", icon: "settings" },
      { href: "/contrato", label: "Contrato", icon: "settings" },
      { href: "/atividades", label: "Atividades", icon: "settings" },
      { href: "/tipo-equipe", label: "Tipo de Equipe", icon: "settings" },
      { href: "/imei", label: "Imei", icon: "settings" },
      { href: "/tipo-servico", label: "Tipo de Servico", icon: "settings" },
      { href: "/nivel-tensao", label: "Nivel de Tensao", icon: "settings" },
      { href: "/porte", label: "Porte", icon: "settings" },
      { href: "/responsavel-distribuidora", label: "Responsavel Distribuidora", icon: "settings" },
      { href: "/municipio", label: "Municipio", icon: "settings" },
    ],
  },
] as const;

const titleMap: Record<string, { title: string; subtitle: string }> = {
  "/home": {
    title: "Home",
    subtitle: "Resumo inicial do tenant e atalhos principais.",
  },
  "/pessoas": {
    title: "Pessoas",
    subtitle: "Cadastro e consulta de pessoas operacionais.",
  },
  "/materiais": {
    title: "Materiais",
    subtitle: "Cadastro e manutencao do catalogo de materiais.",
  },
  "/projetos": {
    title: "Projetos",
    subtitle: "Cadastro e acompanhamento dos projetos operacionais.",
  },
  "/locacao": {
    title: "Locacao",
    subtitle: "Controle de recursos alocados por locacao.",
  },
  "/programacao-simples": {
    title: "Programacao",
    subtitle: "Cadastro da programacao para multiplas equipes.",
  },
  "/programacao-visualizacao": {
    title: "Visualizacao Programacao",
    subtitle: "Lista filtrada e calendario semanal da programacao.",
  },
  "/programacao": {
    title: "Programacao (Legado)",
    subtitle: "Tela antiga desativada com redirecionamento para o novo fluxo.",
  },
  "/medicao": {
    title: "Medicao",
    subtitle: "Gestao de medicoes operacionais por projeto e periodo.",
  },
  "/entrada": {
    title: "Entrada Estoque",
    subtitle: "Lancamentos de entrada no estoque fisico.",
  },
  "/saida": {
    title: "Saida Estoque",
    subtitle: "Lancamentos de saida do estoque fisico.",
  },
  "/estoque": {
    title: "Estoque Atual",
    subtitle: "Consulta de saldo fisico consolidado.",
  },
  "/cargo": {
    title: "Cargo",
    subtitle: "Cadastro e manutencao dos cargos operacionais.",
  },
  "/equipes": {
    title: "Equipes",
    subtitle: "Cadastro e manutencao das equipes operacionais.",
  },
  "/prioridade": {
    title: "Prioridade",
    subtitle: "Cadastro base de prioridades operacionais.",
  },
  "/centro-servico": {
    title: "Centro de Servico",
    subtitle: "Cadastro base dos centros de servico do tenant.",
  },
  "/contrato": {
    title: "Contrato",
    subtitle: "Cadastro base de contratos do tenant.",
  },
  "/atividades": {
    title: "Atividades",
    subtitle: "Cadastro de atividades de contratos e servicos.",
  },
  "/tipo-equipe": {
    title: "Tipo de Equipe",
    subtitle: "Cadastro base dos tipos de equipes.",
  },
  "/imei": {
    title: "Imei",
    subtitle: "Cadastro base de identificadores IMEI operacionais.",
  },
  "/tipo-servico": {
    title: "Tipo de Servico",
    subtitle: "Cadastro base dos tipos de servico.",
  },
  "/nivel-tensao": {
    title: "Nivel de Tensao",
    subtitle: "Cadastro base dos niveis de tensao.",
  },
  "/porte": {
    title: "Porte",
    subtitle: "Cadastro base de porte para classificacao operacional.",
  },
  "/responsavel-distribuidora": {
    title: "Responsavel Distribuidora",
    subtitle: "Cadastro base dos responsaveis da distribuidora.",
  },
  "/municipio": {
    title: "Municipio",
    subtitle: "Cadastro base de municipios do tenant.",
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
    case "folder":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3.75 8.25a1.5 1.5 0 0 1 1.5-1.5h4.2l1.5 1.5h7.8a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-13.5a1.5 1.5 0 0 1-1.5-1.5v-9Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "briefcase":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4.75 8.75h14.5a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8.5 8.75V7.5A1.75 1.75 0 0 1 10.25 5.75h3.5A1.75 1.75 0 0 1 15.5 7.5v1.25"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5.25 6.75h13.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-10a1.5 1.5 0 0 1 1.5-1.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M8 4.75v3M16 4.75v3M3.75 10.25h16.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

  const displayName = session.user.displayName?.trim() || "Usuario";
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

        <main className={styles.mainContent} data-main-content-scroll="true">
          {children}
        </main>
      </div>
    </div>
  );
}
