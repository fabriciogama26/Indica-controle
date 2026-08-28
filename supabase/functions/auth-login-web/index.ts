// Edge Function: auth-login-web
// Login web por login_name + senha, com auditoria em login_audit.
// Requer variaveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/http.ts'


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

// A ordem aqui e de seguranca, nao de conveniencia: cf-connecting-ip e escrito
// pelo proxy da Supabase e o cliente nao consegue forjar. Ja o x-forwarded-for
// e uma lista onde a entrada MAIS A ESQUERDA e exatamente o que o cliente
// mandou — usar essa entrada como chave de rate limit permite trocar o valor a
// cada request e anular o limite. Por isso o fallback pega a entrada mais a
// direita, que e a que o proxy mais proximo anexou.
const getClientIp = (req: Request) => {
  const connecting = (req.headers.get('cf-connecting-ip') || '').trim()
  if (connecting) return connecting

  const forwarded = req.headers.get('x-forwarded-for') || ''
  const hops = forwarded.split(',').map((value) => value.trim()).filter(Boolean)
  if (hops.length > 0) return hops[hops.length - 1]

  return (req.headers.get('x-real-ip') || '').trim()
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

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
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

  const { data: rateData, error: rateError } = await supabaseAdmin.rpc('rate_limit_check_and_hit', {
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

  // Segunda barreira, so por login_name. O limite por (ip|login) acima protege
  // contra um atacante unico; este protege a CONTA quando as tentativas vem
  // distribuidas por muitos IPs, caso em que a primeira chave nunca satura.
  // Janela maior e teto menor porque login legitimo nao erra 10 vezes em 15 min.
  const { data: loginRateData, error: loginRateError } = await supabaseAdmin.rpc('rate_limit_check_and_hit', {
    p_scope: 'auth',
    p_route: 'auth.login.web.identity',
    p_identity_hash: await sha256Hex(`login|${loginName}`),
    p_owner_id: null,
    p_ip_hash: null,
    p_max_hits: 10,
    p_window_seconds: 900,
  })

  if (loginRateError) {
    return respond(500, { success: false, message: 'Falha ao validar limite de requisicoes.' })
  }

  const loginRateResult = Array.isArray(loginRateData) ? loginRateData[0] : loginRateData
  if (loginRateResult?.allowed === false) {
    const retryAfterSeconds = Number(loginRateResult.retry_after) || 900
    return respond(
      429,
      { success: false, message: `Limite de requisicoes excedido. Tente em ${retryAfterSeconds} segundos.` },
      { 'Retry-After': String(retryAfterSeconds) },
    )
  }

  const { data: userRow, error: userErr } = await supabaseAdmin
    .from('app_users')
    .select('id, email, role_id, tenant_id, ativo, login_name')
    .eq('login_name', loginName)
    .maybeSingle()

  if (userErr || !userRow?.email) {
    const failedEventAt = new Date().toISOString()
    await supabaseAdmin.from('login_audit').insert({
      user_id: null,
      tenant_id: null,
      event_type: 'LOGIN',
      event_at: failedEventAt,
      status: 'FAILED',
      reason: 'USER_NOT_FOUND',
      source,
      login_name: loginName,
      logged_in_at: failedEventAt,
      created_at: failedEventAt,
    })

    return respond(401, { success: false, message: 'Login ou senha invalidos.' })
  }

  if (userRow.ativo === false) {
    const failedEventAt = new Date().toISOString()
    await supabaseAdmin.from('login_audit').insert({
      user_id: userRow.id,
      tenant_id: userRow.tenant_id,
      event_type: 'LOGIN',
      event_at: failedEventAt,
      status: 'FAILED',
      reason: 'INACTIVE',
      source,
      login_name: loginName,
      logged_in_at: failedEventAt,
      created_by: userRow.id,
      updated_by: userRow.id,
    })

    return respond(403, { success: false, message: 'Usuario inativo.' })
  }

  const { data: roleRow } = await supabaseAdmin
    .from('app_roles')
    .select('id, role_key')
    .eq('id', userRow.role_id)
    .maybeSingle()

  const { data: authData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
    email: userRow.email,
    password,
  })

  if (signInError || !authData?.session?.access_token || !authData.session.refresh_token) {
    const failedEventAt = new Date().toISOString()
    await supabaseAdmin.from('login_audit').insert({
      user_id: userRow.id,
      tenant_id: userRow.tenant_id,
      event_type: 'LOGIN',
      event_at: failedEventAt,
      status: 'FAILED',
      reason: 'AUTH_INVALID',
      source,
      login_name: loginName,
      logged_in_at: failedEventAt,
      created_by: userRow.id,
      updated_by: userRow.id,
    })

    return respond(401, { success: false, message: 'Login ou senha invalidos.' })
  }

  const sessionRef = crypto.randomUUID()
  const eventAt = new Date().toISOString()

  const { data: auditRow, error: auditError } = await supabaseAdmin
    .from('login_audit')
    .insert({
      user_id: userRow.id,
      tenant_id: userRow.tenant_id,
      event_type: 'LOGIN',
      event_at: eventAt,
      session_ref: sessionRef,
      status: 'SUCCESS',
      source,
      login_name: loginName,
      logged_in_at: eventAt,
      created_by: userRow.id,
      updated_by: userRow.id,
    })
    .select('id')
    .maybeSingle()

  if (auditError || !auditRow?.id) {
    console.error('auth-login-web login_audit insert failed', {
      auditError,
      auditRow,
      userId: userRow.id,
      tenantId: userRow.tenant_id,
      loginName,
      sessionRef,
      eventAt,
    })
    await supabaseAuth.auth.signOut(authData.session.access_token).catch(() => null)
    return respond(500, { success: false, message: 'Falha ao registrar auditoria de login.' })
  }

  return respond(200, {
    success: true,
    message: 'OK',
    access_token: authData.session.access_token,
    refresh_token: authData.session.refresh_token,
    expires_in: authData.session.expires_in,
    token_type: authData.session.token_type,
    user_id: userRow.id,
    role: roleRow?.role_key ?? 'user',
    role_id: userRow.role_id,
    tenant_id: userRow.tenant_id,
    login_name: userRow.login_name,
    login_audit_id: auditRow.id,
    session_ref: sessionRef,
  })
})
