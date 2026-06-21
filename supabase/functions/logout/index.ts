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

type SessionAuditContext = {
  userId: string
  tenantId: string
  loginName: string
  sessionRef: string
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const resolveSessionAuditContext = async (
  auditId: string,
  sessionRef: string,
): Promise<SessionAuditContext | null> => {
  const query = supabase
    .from('login_audit')
    .select('user_id, tenant_id, login_name, session_ref')
    .eq('event_type', 'LOGIN')
    .limit(1)

  const { data, error } = auditId
    ? await query.eq('id', auditId).maybeSingle()
    : await query.eq('session_ref', sessionRef).order('event_at', { ascending: false }).maybeSingle()

  if (error || !data?.user_id || !data?.tenant_id || !data?.session_ref) {
    return null
  }

  return {
    userId: String(data.user_id),
    tenantId: String(data.tenant_id),
    loginName: String(data.login_name ?? ''),
    sessionRef: String(data.session_ref),
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond(405, { success: false, message: 'method_not_allowed' })

  const body = await req.json().catch(() => ({}))
  const auditId = String(body.login_audit_id ?? '').trim()
  const sessionRef = String(body.session_ref ?? '').trim()
  const reason = String(body.reason ?? '').trim()
  const source = String(body.source ?? 'APP').trim()
  const accessToken = getBearerToken(req)
  let auditContext: SessionAuditContext | null = null

  if (accessToken) {
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)

    if (!authError && authData?.user?.id) {
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
        const loginEvent = await resolveSessionAuditContext(auditId, '')
        if (!loginEvent || loginEvent.userId !== appUser.id || loginEvent.tenantId !== appUser.tenant_id) {
          return respond(400, { success: false, message: 'Sessao auditada nao encontrada.' })
        }

        resolvedSessionRef = loginEvent.sessionRef
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

      auditContext = {
        userId: appUser.id,
        tenantId: appUser.tenant_id,
        loginName: String(appUser.login_name ?? ''),
        sessionRef: resolvedSessionRef,
      }
    }
  }

  if (!auditContext) {
    const canFallbackToExpiredAudit = reason === 'TOKEN_EXPIRED' && (auditId || sessionRef)
    if (!canFallbackToExpiredAudit) {
      return respond(401, { success: false, message: accessToken ? 'Sessao invalida.' : 'Nao autenticado.' })
    }

    auditContext = await resolveSessionAuditContext(auditId, sessionRef)
    if (!auditContext) {
      return respond(400, { success: false, message: 'Sessao auditada nao encontrada.' })
    }
  }

  const { data: existingLogout } = await supabase
    .from('login_audit')
    .select('id')
    .eq('user_id', auditContext.userId)
    .eq('tenant_id', auditContext.tenantId)
    .eq('event_type', 'LOGOUT')
    .eq('session_ref', auditContext.sessionRef)
    .maybeSingle()

  if (existingLogout?.id) {
    return respond(200, { success: true, message: 'Logout ja registrado.', login_audit_id: existingLogout.id })
  }

  const eventAt = new Date().toISOString()
  const { data: logoutAudit, error } = await supabase
    .from('login_audit')
    .insert({
      tenant_id: auditContext.tenantId,
      user_id: auditContext.userId,
      event_type: 'LOGOUT',
      event_at: eventAt,
      session_ref: auditContext.sessionRef,
      status: 'SUCCESS',
      reason: reason || 'USER_LOGOUT',
      source,
      login_name: auditContext.loginName,
      logged_in_at: null,
      logged_out_at: eventAt,
      created_by: auditContext.userId,
      updated_by: auditContext.userId,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    return respond(500, { success: false, message: 'Falha ao registrar logout.' })
  }

  return respond(200, { success: true, message: 'Logout registrado.', login_audit_id: logoutAudit?.id ?? null })
})
