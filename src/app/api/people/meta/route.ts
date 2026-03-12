import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type JobTitleRow = {
  id: string;
  code: string;
  name: string;
};

type JobTitleTypeRow = {
  id: string;
  job_title_id: string;
  code: string;
  name: string;
};

type JobLevelRow = {
  level: string;
};

function normalizeName(value: string | null | undefined) {
  return String(value ?? "").trim();
}

async function fetchJobTitles(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("job_titles")
    .select("id, code, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<JobTitleRow[]>();

  if (error) {
    return [] as Array<{ id: string; code: string; name: string }>;
  }

  return (data ?? [])
    .map((item) => ({
      id: item.id,
      code: normalizeName(item.code),
      name: normalizeName(item.name),
    }))
    .filter((item) => Boolean(item.id) && Boolean(item.name));
}

async function fetchJobTitleTypes(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("job_title_types")
    .select("id, job_title_id, code, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<JobTitleTypeRow[]>();

  if (error) {
    return [] as Array<{ id: string; jobTitleId: string; code: string; name: string }>;
  }

  return (data ?? [])
    .map((item) => ({
      id: item.id,
      jobTitleId: item.job_title_id,
      code: normalizeName(item.code),
      name: normalizeName(item.name),
    }))
    .filter((item) => Boolean(item.id) && Boolean(item.jobTitleId) && Boolean(item.name));
}

async function fetchJobLevels(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("job_levels")
    .select("level")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("level", { ascending: true })
    .returns<JobLevelRow[]>();

  if (error) {
    return [] as Array<{ level: string }>;
  }

  return (data ?? [])
    .map((item) => ({ level: normalizeName(item.level) }))
    .filter((item) => Boolean(item.level));
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados de pessoas.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const [jobTitles, jobTitleTypes, jobLevels] = await Promise.all([
      fetchJobTitles(supabase, appUser.tenant_id),
      fetchJobTitleTypes(supabase, appUser.tenant_id),
      fetchJobLevels(supabase, appUser.tenant_id),
    ]);

    return NextResponse.json({
      jobTitles,
      jobTitleTypes,
      jobLevels,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados de pessoas." }, { status: 500 });
  }
}
