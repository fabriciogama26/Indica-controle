import { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_STOCK_SERIAL_POLICY, type StockSerialPolicy } from "@/lib/stockSerialPolicy";

type TenantStockSerialPolicyRow = {
  allow_pending_on_entry: boolean | null;
  allow_pending_on_transfer: boolean | null;
  allow_pending_on_exit: boolean | null;
  updated_at: string | null;
};

export type LoadedStockSerialPolicy = StockSerialPolicy & {
  updatedAt: string | null;
};

/**
 * Le a politica de pendencia de serial do contrato. Ausencia de linha nao e erro:
 * um tenant criado depois da migration 421, ou antes de alguem abrir a tela, cai no
 * default que reproduz a regra anterior. Movimentacao de estoque nao pode quebrar
 * por falta de configuracao.
 */
export async function loadStockSerialPolicy(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ data: LoadedStockSerialPolicy; error: null } | { data: null; error: unknown }> {
  const { data, error } = await supabase
    .from("tenant_stock_serial_policy")
    .select("allow_pending_on_entry, allow_pending_on_transfer, allow_pending_on_exit, updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle<TenantStockSerialPolicyRow>();

  if (error) {
    return { data: null, error };
  }

  if (!data) {
    return { data: { ...DEFAULT_STOCK_SERIAL_POLICY, updatedAt: null }, error: null };
  }

  return {
    data: {
      allowPendingOnEntry: data.allow_pending_on_entry ?? DEFAULT_STOCK_SERIAL_POLICY.allowPendingOnEntry,
      allowPendingOnTransfer: data.allow_pending_on_transfer ?? DEFAULT_STOCK_SERIAL_POLICY.allowPendingOnTransfer,
      allowPendingOnExit: data.allow_pending_on_exit ?? DEFAULT_STOCK_SERIAL_POLICY.allowPendingOnExit,
      updatedAt: data.updated_at ?? null,
    },
    error: null,
  };
}
