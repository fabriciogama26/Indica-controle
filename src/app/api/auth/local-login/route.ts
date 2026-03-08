import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const loginName = String(body.login_name ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  const expectedLogin = (process.env.LOCAL_AUTH_USERNAME ?? "").trim().toLowerCase();
  const expectedPassword = process.env.LOCAL_AUTH_PASSWORD ?? "";

  if (!loginName || !password) {
    return NextResponse.json(
      { success: false, message: "Informe login e senha." },
      { status: 400 },
    );
  }

  if (!expectedLogin || !expectedPassword) {
    return NextResponse.json(
      { success: false, message: "Login local nao configurado." },
      { status: 500 },
    );
  }

  if (loginName !== expectedLogin || password !== expectedPassword) {
    return NextResponse.json(
      { success: false, message: "Login ou senha invalidos." },
      { status: 401 },
    );
  }

  const expiresIn = 43200;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  return NextResponse.json({
    success: true,
    message: "Login local concluido.",
    access_token: "local-token",
    refresh_token: "local-refresh-token",
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: "bearer",
    user_id: process.env.LOCAL_USER_ID ?? "local-user",
    role: process.env.LOCAL_ROLE ?? "admin",
    role_id: null,
    tenant_id: process.env.LOCAL_TENANT_ID ?? "local-tenant",
    login_name: loginName,
    display_name: loginName,
    login_audit_id: null,
    session_ref: null,
  });
}
