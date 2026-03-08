// Edge Function: logout
// Registra evento imutavel de logout em login_audit.

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const respond = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: corsHeaders })

const getBearerToken = (req: Request) => {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.substring(7).trim()
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond(405, { success: false, message: 'method_not_allowed' })

  const accessToken = getBearerToken(req)
  if (!accessToken) return respond(401, { success: false, message: 'Nao autenticado.' })

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData?.user?.id) return respond(401, { success: false, message: 'Sessao invalida.' })

  const body = await req.json().catch(() => ({}))
  const auditId = String(body.login_audit_id ?? '').trim()
  const sessionRef = String(body.session_ref ?? '').trim()
  const reason = String(body.reason ?? '').trim()
  const source = String(body.source ?? 'APP').trim()

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('id, tenant_id, ativo, login_name')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (appUserError || !appUser?.id || appUser.ativo === false) {
    return respond(403, { success: false, message: 'Usuario sem permissao.' })
  }

  let resolvedSessionRef = sessionRef

  if (!resolvedSessionRef && auditId) {
    const { data: loginEvent, error: loginEventError } = await supabase
      .from('login_audit')
      .select('session_ref')
      .eq('id', auditId)
      .eq('user_id', appUser.id)
      .eq('tenant_id', appUser.tenant_id)
      .maybeSingle()

    if (loginEventError || !loginEvent?.session_ref) {
      return respond(400, { success: false, message: 'Sessao auditada nao encontrada.' })
    }

    resolvedSessionRef = String(loginEvent.session_ref)
  }

  if (!resolvedSessionRef) {
    const { data: latestAudit, error: latestAuditError } = await supabase
      .from('login_audit')
      .select('session_ref')
      .eq('user_id', appUser.id)
      .eq('tenant_id', appUser.tenant_id)
      .eq('event_type', 'LOGIN')
      .not('session_ref', 'is', null)
      .order('event_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestAuditError || !latestAudit?.session_ref) {
      return respond(400, { success: false, message: 'Nenhuma sessao encontrada para logout.' })
    }

    resolvedSessionRef = String(latestAudit.session_ref)
  }

  const { data: existingLogout } = await supabase
    .from('login_audit')
    .select('id')
    .eq('user_id', appUser.id)
    .eq('tenant_id', appUser.tenant_id)
    .eq('event_type', 'LOGOUT')
    .eq('session_ref', resolvedSessionRef)
    .maybeSingle()

  if (existingLogout?.id) {
    return respond(200, { success: true, message: 'Logout ja registrado.', login_audit_id: existingLogout.id })
  }

  const eventAt = new Date().toISOString()
  const { data: logoutAudit, error } = await supabase
    .from('login_audit')
    .insert({
      tenant_id: appUser.tenant_id,
      user_id: appUser.id,
      event_type: 'LOGOUT',
      event_at: eventAt,
      session_ref: resolvedSessionRef,
      status: 'SUCCESS',
      reason: reason || 'USER_LOGOUT',
      source,
      login_name: appUser.login_name,
      logged_in_at: null,
      logged_out_at: eventAt,
      created_by: appUser.id,
      updated_by: appUser.id,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    return respond(500, { success: false, message: 'Falha ao registrar logout.' })
  }

  return respond(200, { success: true, message: 'Logout registrado.', login_audit_id: logoutAudit?.id ?? null })
})
