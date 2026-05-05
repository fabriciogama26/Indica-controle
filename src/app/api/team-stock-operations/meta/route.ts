import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { isSerialTrackedMaterial, normalizeSerialTrackingType, SerialTrackingType } from "@/lib/materialSerialTracking";

type StockCenterRow = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
};

type TeamRow = {
  id: string;
  name: string;
  stock_center_id: string | null;
  foreman_person_id: string | null;
  ativo: boolean;
};

type PersonRow = {
  id: string;
  nome: string;
};

type ProjectRow = {
  id: string;
  sob: string;
};

type MaterialRow = {
  id: string;
  codigo: string;
  descricao: string;
  tipo: string;
  is_transformer: boolean;
  serial_tracking_type: SerialTrackingType | null;
};

type ReversalReasonRow = {
  code: string;
  label_pt: string;
  requires_notes: boolean;
};

const DEFAULT_REVERSAL_REASONS = [
  { code: "DATA_ENTRY_ERROR", label: "Erro de digitacao", requiresNotes: false },
  { code: "WRONG_STOCK_CENTER", label: "Centro incorreto", requiresNotes: false },
  { code: "WRONG_MATERIAL", label: "Material incorreto", requiresNotes: false },
  { code: "WRONG_QUANTITY", label: "Quantidade incorreta", requiresNotes: false },
  { code: "DUPLICATE_ENTRY", label: "Lancamento duplicado", requiresNotes: false },
] as const;

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados das operacoes de equipe.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;

    const [stockCentersResult, teamsResult, projectsResult, materialsResult, reversalReasonsResult] = await Promise.all([
      supabase
        .from("stock_centers")
        .select("id, name, center_type")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .eq("center_type", "OWN")
        .order("name", { ascending: true })
        .returns<StockCenterRow[]>(),
      supabase
        .from("teams")
        .select("id, name, stock_center_id, foreman_person_id, ativo")
        .eq("tenant_id", appUser.tenant_id)
        .order("name", { ascending: true })
        .returns<TeamRow[]>(),
      supabase
        .from("project")
        .select("id, sob")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .order("sob", { ascending: true })
        .returns<ProjectRow[]>(),
      supabase
        .from("materials")
        .select("id, codigo, descricao, tipo, is_transformer, serial_tracking_type")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .order("codigo", { ascending: true })
        .returns<MaterialRow[]>(),
      supabase
        .from("stock_transfer_reversal_reason_catalog")
        .select("code, label_pt, requires_notes")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true })
        .returns<ReversalReasonRow[]>(),
    ]);

    if (stockCentersResult.error || teamsResult.error || projectsResult.error || materialsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar metadados das operacoes de equipe." }, { status: 500 });
    }

    const activeTeams = (teamsResult.data ?? []).filter((team) => Boolean(team.ativo));
    const foremanIds = Array.from(
      new Set(activeTeams.map((team) => String(team.foreman_person_id ?? "").trim()).filter(Boolean)),
    );
    const foremenResult = foremanIds.length
      ? await supabase
          .from("people")
          .select("id, nome")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", foremanIds)
          .returns<PersonRow[]>()
      : { data: [], error: null };

    if (foremenResult.error) {
      return NextResponse.json({ message: "Falha ao carregar metadados das operacoes de equipe." }, { status: 500 });
    }

    const teamStockCenterIds = new Set(
      (teamsResult.data ?? []).map((team) => String(team.stock_center_id ?? "").trim()).filter(Boolean),
    );
    const stockCenterMap = new Map((stockCentersResult.data ?? []).map((row) => [row.id, row.name]));
    const foremanMap = new Map((foremenResult.data ?? []).map((row) => [row.id, row.nome]));

    return NextResponse.json({
      fieldReturnOriginName: "CAMPO / INSTALADO",
      stockCenters: (stockCentersResult.data ?? [])
        .filter((row) => !teamStockCenterIds.has(row.id))
        .map((row) => ({
          id: row.id,
          name: row.name,
        })),
      teams: activeTeams
        .map((row) => ({
          id: row.id,
          name: row.name,
          stockCenterId: row.stock_center_id,
          stockCenterName: row.stock_center_id
            ? stockCenterMap.get(row.stock_center_id) ?? "Nao informado"
            : "Sem centro proprio vinculado",
          foremanName: row.foreman_person_id
            ? String(foremanMap.get(row.foreman_person_id) ?? "").trim() || "Nao informado"
            : "Nao informado",
          isActive: Boolean(row.ativo),
        })),
      projects: (projectsResult.data ?? []).map((row) => ({
        id: row.id,
        projectCode: row.sob,
      })),
      materials: (materialsResult.data ?? []).map((row) => ({
        id: row.id,
        materialCode: row.codigo,
        description: row.descricao,
        materialType: String(row.tipo ?? "").trim().toUpperCase(),
        isTransformer: isSerialTrackedMaterial(normalizeSerialTrackingType(row.serial_tracking_type ?? (row.is_transformer ? "TRAFO" : "NONE"))),
        serialTrackingType: normalizeSerialTrackingType(row.serial_tracking_type ?? (row.is_transformer ? "TRAFO" : "NONE")),
      })),
      reversalReasons: reversalReasonsResult.error
        ? DEFAULT_REVERSAL_REASONS
        : (reversalReasonsResult.data ?? []).map((row) => ({
            code: row.code,
            label: row.label_pt,
            requiresNotes: Boolean(row.requires_notes),
          })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados das operacoes de equipe." }, { status: 500 });
  }
}
