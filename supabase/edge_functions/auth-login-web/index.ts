// Edge Function: auth-login-web
// Login web por login_name + senha, com auditoria em login_audit.
// Requer variaveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const respond = (
  status: number,
  payload: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, ...extraHeaders },
  })

const normalizeLoginName = (value: unknown) => String(value ?? '').trim().toLowerCase()

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim()
    if (ip) return ip
  }

  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || ''
}

const sha256Hex = async (value: string) => {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return respond(405, { success: false, message: 'method_not_allowed' })
  }

  const body = await req.json().catch(() => ({}))
  const loginName = normalizeLoginName(body.login_name ?? body.loginName ?? body.username)
  const password = String(body.password ?? '')
  const source = String(body.source ?? 'SITE')

  if (!loginName || !password) {
    return respond(400, { success: false, message: 'Informe login e senha.' })
  }

  const ip = getClientIp(req) || 'unknown'
  const identityHash = await sha256Hex(`${ip}|${loginName}`)

  const { data: rateData, error: rateError } = await supabase.rpc('rate_limit_check_and_hit', {
    p_scope: 'auth',
    p_route: 'auth.login.web',
    p_identity_hash: identityHash,
    p_owner_id: null,
    p_ip_hash: null,
    p_max_hits: 5,
    p_window_seconds: 60,
  })

  if (rateError) {
    return respond(500, { success: false, message: 'Falha ao validar limite de requisicoes.' })
  }

  const rateResult = Array.isArray(rateData) ? rateData[0] : rateData
  if (rateResult?.allowed === false) {
    const retryAfterSeconds = Number(rateResult.retry_after) || 60
    return respond(
      429,
      { success: false, message: `Limite de requisicoes excedido. Tente em ${retryAfterSeconds} segundos.` },
      { 'Retry-After': String(retryAfterSeconds) },
    )
  }

  const { data: userRow, error: userErr } = await supabase
    .from('app_users')
    .select('id, email, role, tenant_id, ativo, login_name')
    .eq('login_name', loginName)
    .maybeSingle()

  if (userErr || !userRow?.email) {
    await supabase.from('login_audit').insert({
      user_id: null,
      tenant_id: null,
      status: 'FAILED',
      reason: 'USER_NOT_FOUND',
      source,
      login_name: loginName,
      created_at: new Date().toISOString(),
    })

    return respond(401, { success: false, message: 'Login ou senha invalidos.' })
  }

  if (userRow.ativo === false) {
    await supabase.from('login_audit').insert({
      user_id: userRow.id,
      tenant_id: userRow.tenant_id,
      status: 'FAILED',
      reason: 'INACTIVE',
      source,
      login_name: loginName,
      created_by: userRow.id,
      updated_by: userRow.id,
    })

    return respond(403, { success: false, message: 'Usuario inativo.' })
  }

  const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
    email: userRow.email,
    password,
  })

  if (signInError || !authData?.session?.access_token || !authData.session.refresh_token) {
    await supabase.from('login_audit').insert({
      user_id: userRow.id,
      tenant_id: userRow.tenant_id,
      status: 'FAILED',
      reason: 'AUTH_INVALID',
      source,
      login_name: loginName,
      created_by: userRow.id,
      updated_by: userRow.id,
    })

    return respond(401, { success: false, message: 'Login ou senha invalidos.' })
  }

  const { data: auditRow } = await supabase
    .from('login_audit')
    .insert({
      user_id: userRow.id,
      tenant_id: userRow.tenant_id,
      status: 'SUCCESS',
      source,
      login_name: loginName,
      created_by: userRow.id,
      updated_by: userRow.id,
    })
    .select('id')
    .maybeSingle()

  return respond(200, {
    success: true,
    message: 'OK',
    access_token: authData.session.access_token,
    refresh_token: authData.session.refresh_token,
    expires_in: authData.session.expires_in,
    token_type: authData.session.token_type,
    user_id: userRow.id,
    role: userRow.role,
    tenant_id: userRow.tenant_id,
    login_name: userRow.login_name,
    login_audit_id: auditRow?.id ?? null,
  })
})
