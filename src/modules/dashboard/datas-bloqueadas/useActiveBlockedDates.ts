"use client";

import { useCallback, useEffect, useState } from "react";

import type { ActiveBlockedDate } from "./types";

type ActiveBlockedDatesResponse = {
  blockedDates?: ActiveBlockedDate[];
  message?: string;
};

/**
 * Carrega as datas bloqueadas ATIVAS de uma janela.
 *
 * Fachada publica do modulo: a Programacao, o Mapa de Programacao e a
 * Visualizacao de Programacao usam este hook em vez de falar com a tabela ou
 * com `/api/blocked-dates`, que exige a permissao do cadastro. O endpoint
 * `/api/blocked-dates/vigentes` aceita o `page_key` de qualquer uma das tres
 * telas consumidoras.
 *
 * A carga fica num `useCallback` e o efeito so a dispara, mesmo padrao de
 * `useProgrammingMeta`: setState direto no corpo do efeito e recusado pelo
 * `react-hooks/set-state-in-effect`.
 *
 * Falha de rede nao vira erro de tela: o aviso e informativo e some sozinho se
 * a carga nao completar. Quem chama recebe `error` e decide se registra.
 */
export function useActiveBlockedDates(params: {
  accessToken: string | null;
  from: string | null;
  to: string | null;
  enabled?: boolean;
}) {
  const { accessToken, from, to } = params;
  const enabled = params.enabled ?? true;
  const [blockedDates, setBlockedDates] = useState<ActiveBlockedDate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadBlockedDates = useCallback(
    async (signal: AbortSignal) => {
      if (!enabled || !accessToken || !from || !to) {
        setBlockedDates([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams({ from, to });
        const response = await fetch(`/api/blocked-dates/vigentes?${query.toString()}`, {
          cache: "no-store",
          signal,
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        const data = (await response.json().catch(() => ({}))) as ActiveBlockedDatesResponse;
        if (!response.ok) {
          throw new Error(data.message ?? "Falha ao carregar datas bloqueadas.");
        }

        setBlockedDates(data.blockedDates ?? []);
      } catch (cause) {
        if ((cause as Error)?.name === "AbortError") {
          return;
        }
        setBlockedDates([]);
        setError(cause);
      } finally {
        if (!signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [accessToken, enabled, from, to],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadBlockedDates(controller.signal);
    return () => controller.abort();
  }, [loadBlockedDates]);

  return { blockedDates, isLoading, error };
}
