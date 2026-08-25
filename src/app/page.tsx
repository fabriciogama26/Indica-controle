"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";
import { isAdminRole } from "@/lib/auth/authorization";
import styles from "./page.module.css";

export default function IndexPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, session } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    const shouldSelectTenant = session?.source === "remote" && isAdminRole(session.user.role);
    router.replace(isAuthenticated ? (shouldSelectTenant ? "/selecionar-contrato" : "/home") : "/login");
  }, [isAuthenticated, isLoading, router, session?.source, session?.user.role]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>Carregando sistema...</div>
    </main>
  );
}
