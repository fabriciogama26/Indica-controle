import { NextRequest, NextResponse } from "next/server";

import { resolveAdminOperator } from "@/lib/server/appUsersAdmin";

type TargetUserRow = {
  id: string;
  tenant_id: string;
  matricula: string | null;
  login_name: string;
  email: string | null;
  auth_user_id: string | null;
  ativo: boolean;
  role_id: string | null;
};

type RoleRow = {
  id?: string | null;
  role_key?: string | null;
} | null;

type InviteHistoryRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  try {
    const resolution = await resolveAdminOperator(request);
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { userId } = await context.params;
    const { supabase, operator } = resolution;

    const { data: targetUser, error: targetUserError } = await supabase
      .from("app_users")
      .select("id, tenant_id, matricula, login_name, email, auth_user_id, ativo, role_id")
      .eq("id", userId)
      .eq("tenant_id", operator.tenantId)
      .maybeSingle<TargetUserRow>();

    if (targetUserError || !targetUser) {
      return NextResponse.json({ message: "Usuario nao encontrado no tenant atual." }, { status: 404 });
    }

    if (!targetUser.email) {
      return NextResponse.json({ message: "Usuario sem email cadastrado para convite." }, { status: 422 });
    }

    if (!targetUser.matricula || !targetUser.login_name) {
      return NextResponse.json(
        { message: "Usuario sem matricula ou login_name para provisionamento no Auth." },
        { status: 422 },
      );
    }

    if (targetUser.auth_user_id) {
      return NextResponse.json({ message: "Usuario ja vinculado ao Auth do Supabase." }, { status: 409 });
    }

    const { data: role, error: roleError } = targetUser.role_id
      ? await supabase.from("app_roles").select("id, role_key").eq("id", targetUser.role_id).maybeSingle<RoleRow>()
      : { data: null, error: null };

    if (roleError) {
      return NextResponse.json({ message: "Falha ao resolver role do usuario para envio do convite." }, { status: 500 });
    }

    const redirectTo = (process.env.PASSWORD_REDIRECT_URL ?? "").trim() || undefined;
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(targetUser.email, {
      redirectTo,
      data: {
        tenant_id: targetUser.tenant_id,
        matricula: targetUser.matricula,
        login_name: targetUser.login_name,
        role: String(role?.role_key ?? "user"),
        ativo: targetUser.ativo,
      },
    });

    if (inviteError) {
      return NextResponse.json({ message: inviteError.message || "Falha ao enviar convite do usuario." }, { status: 500 });
    }

    const { data: historyData, error: historyError } = await supabase.rpc("append_user_invite_history", {
      p_tenant_id: operator.tenantId,
      p_actor_user_id: operator.appUserId,
      p_target_user_id: targetUser.id,
      p_email: targetUser.email,
      p_redirect_to: redirectTo ?? null,
    });

    if (historyError) {
      return NextResponse.json({
        success: true,
        warning: true,
        message: "Convite enviado, mas falhou ao registrar historico.",
      });
    }

    const historyResult = (historyData ?? {}) as InviteHistoryRpcResult;
    if (historyResult.success !== true) {
      return NextResponse.json({
        success: true,
        warning: true,
        message: historyResult.message ?? "Convite enviado, mas falhou ao registrar historico.",
      });
    }

    return NextResponse.json({
      success: true,
      message: "Convite enviado com sucesso.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao enviar convite do usuario." }, { status: 500 });
  }
}
