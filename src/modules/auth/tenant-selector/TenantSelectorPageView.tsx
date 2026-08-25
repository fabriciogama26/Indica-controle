"use client";

import Image from "next/image";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { isAdminRole } from "@/lib/auth/authorization";
import styles from "./TenantSelectorPageView.module.css";

type TenantOption = {
  id: string;
  name: string;
};

type TenantListResponse = {
  activeTenantId?: string | null;
  tenants?: TenantOption[];
  message?: string;
};

async function fetchTenantOptions(accessToken: string): Promise<TenantListResponse> {
  const response = await fetch("/api/auth/active-tenant", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = (await response.json().catch(() => ({}))) as TenantListResponse;
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar contratos.");
  }

  return data;
}

async function saveActiveTenant(accessToken: string, tenantId: string) {
  const response = await fetch("/api/auth/active-tenant", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tenantId }),
  });

  const data = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao selecionar contrato.");
  }

  return data;
}

export function TenantSelectorPageView() {
  const router = useRouter();
  const { session, isAuthenticated, isLoading } = useAuth();
  const [manualTenantId, setManualTenantId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const accessToken = session?.accessToken ?? "";
  const isAdmin = isAdminRole(session?.user.role);
  const shouldSelectTenant = isAdmin && (session?.user.availableTenantIds?.length ?? 0) > 1;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (!shouldSelectTenant) {
      router.replace("/home");
    }
  }, [isAuthenticated, isLoading, router, shouldSelectTenant]);

  const tenantsQuery = useQuery({
    queryKey: ["active-tenant-options", accessToken],
    queryFn: () => fetchTenantOptions(accessToken),
    enabled: Boolean(accessToken && shouldSelectTenant),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const tenants = tenantsQuery.data?.tenants ?? [];
  const preferredTenantId =
    tenants.find((tenant) => tenant.id === tenantsQuery.data?.activeTenantId)?.id ?? tenants[0]?.id ?? "";
  const selectedTenantId = manualTenantId || preferredTenantId;

  const selectTenantMutation = useMutation({
    mutationFn: () => saveActiveTenant(accessToken, selectedTenantId),
    onSuccess: () => {
      window.location.assign("/home");
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : "Falha ao selecionar contrato.");
    },
  });

  function handleSubmit() {
    setFeedback(null);
    if (!selectedTenantId) {
      setFeedback("Selecione um contrato.");
      return;
    }

    selectTenantMutation.mutate();
  }

  const loading = isLoading || tenantsQuery.isLoading;
  const message = feedback ?? (tenantsQuery.error instanceof Error ? tenantsQuery.error.message : null);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.logoOrbit}>
          <div className={styles.logoCircle}>
            <Image
              src="/indica.png"
              alt="INDICA - SERVICOS"
              width={184}
              height={184}
              className={styles.logoImage}
              priority
            />
          </div>
        </div>

        <div className={styles.cardContent}>
          <h1 className={styles.title}>Selecione o contrato</h1>

          <div className={styles.contractList} aria-busy={loading}>
            {loading ? <div className={styles.loadingBox}>Carregando contratos...</div> : null}

            {!loading && tenants.length === 0 ? (
              <div className={styles.loadingBox}>Nenhum contrato disponivel.</div>
            ) : null}

            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                type="button"
                className={tenant.id === selectedTenantId ? styles.contractActive : styles.contract}
                onClick={() => setManualTenantId(tenant.id)}
              >
                <strong>{tenant.name}</strong>
                <span>{tenant.id}</span>
              </button>
            ))}
          </div>

          <div className={styles.feedbackSlot} aria-live="polite">
            {message ? <div className={styles.errorBox}>{message}</div> : null}
          </div>

          <button
            type="button"
            className={styles.submitButton}
            disabled={loading || selectTenantMutation.isPending || !selectedTenantId}
            onClick={handleSubmit}
          >
            {selectTenantMutation.isPending ? "Selecionando..." : "Continuar"}
          </button>
        </div>
      </section>
    </main>
  );
}
