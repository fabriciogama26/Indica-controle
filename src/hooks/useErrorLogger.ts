"use client";

import { useCallback } from "react";

import { useAuth } from "@/hooks/useAuth";

type ErrorLogContext = Record<string, unknown> | undefined;

function functionsBaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stacktrace: error.stack ?? "",
      name: error.name,
    };
  }

  if (typeof error === "string" && error.trim()) {
    return {
      message: error,
      stacktrace: "",
      name: "Error",
    };
  }

  return {
    message: "",
    stacktrace: "",
    name: "Error",
  };
}

export function useErrorLogger(screen: string) {
  const { session } = useAuth();

  return useCallback(async (message: string, error?: unknown, context?: ErrorLogContext) => {
    const accessToken = session?.accessToken;
    const baseUrl = functionsBaseUrl();

    if (!accessToken || !baseUrl) {
      return;
    }

    const normalizedError = normalizeError(error);

    await fetch(`${baseUrl}/functions/v1/log_error`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      },
      body: JSON.stringify({
        source: "WEB",
        severity: "ERROR",
        screen,
        message: message || normalizedError.message || "Erro sem mensagem",
        stacktrace: normalizedError.stacktrace,
        errorName: normalizedError.name,
        context,
      }),
    }).catch(() => null);
  }, [screen, session?.accessToken]);
}
