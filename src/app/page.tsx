"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";
import styles from "./page.module.css";

export default function IndexPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    router.replace(isAuthenticated ? "/home" : "/login");
  }, [isAuthenticated, isLoading, router]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>Carregando sistema...</div>
    </main>
  );
}
