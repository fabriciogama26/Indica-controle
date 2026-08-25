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
    const shouldSelectTenant =
      isAdminRole(session?.user.role) && (session?.user.availableTenantIds?.length ?? 0) > 1;
    router.replace(isAuthenticated ? (shouldSelectTenant ? "/selecionar-contrato" : "/home") : "/login");
  }, [isAuthenticated, isLoading, router, session?.user.availableTenantIds?.length, session?.user.role]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>Carregando sistema...</div>
    </main>
  );
}
