"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PropsWithChildren, useEffect, useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./AppShell.module.css";

const menuItems = [
  { href: "/home", label: "Home" },
  { href: "/cadastro-base", label: "Cadastro Base" },
  { href: "/pessoas", label: "Pessoas" },
  { href: "/materiais", label: "Materiais" },
  { href: "/entrada", label: "Entrada" },
  { href: "/saida", label: "Saida" },
  { href: "/estoque", label: "Estoque Atual" },
];

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
};

export function AppShell({ children }: PropsWithChildren) {
  const { session, isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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

  if (isLoading || !session) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.loadingCard}>Carregando sessao...</div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <div className={styles.brandEyebrow}>INDICA - SERVICOS</div>
          <h1 className={styles.brandTitle}>RQM SaaS</h1>
          <p className={styles.brandTenant}>Tenant: {session.user.tenantId}</p>
        </div>

        <nav className={styles.nav}>
          {menuItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={isActive ? styles.navItemActive : styles.navItem}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          className={styles.logoutButton}
          onClick={() => logout().then(() => router.replace("/login"))}
        >
          Sair
        </button>
      </aside>

      <div className={styles.contentArea}>
        <header className={styles.topbar}>
          <div>
            <div className={styles.topbarTitle}>{header.title}</div>
            <div className={styles.topbarSubtitle}>{header.subtitle}</div>
          </div>
          <div className={styles.userInfo}>
            <span className={styles.loginName}>{session.user.loginName}</span>
            <span className={styles.userBadge}>{session.user.role}</span>
          </div>
        </header>

        <main className={styles.mainContent}>{children}</main>
      </div>
    </div>
  );
}
