// Edge Function: logout
// Marks login audit as closed for the authenticated user.

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
  const reason = String(body.reason ?? '').trim()
  const source = String(body.source ?? 'APP').trim()
  if (!auditId) return respond(400, { success: false, message: 'login_audit_id obrigatorio.' })

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('id, tenant_id, ativo')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (appUserError || !appUser?.id || appUser.ativo === false) {
    return respond(403, { success: false, message: 'Usuario sem permissao.' })
  }

  const { error } = await supabase
    .from('login_audit')
    .update({
      logged_out_at: new Date().toISOString(),
      reason: reason || null,
      source,
      updated_by: appUser.id,
    })
    .eq('id', auditId)
    .eq('user_id', appUser.id)
    .eq('tenant_id', appUser.tenant_id)

  if (error) {
    return respond(500, { success: false, message: 'Falha ao registrar logout.' })
  }

  return respond(200, { success: true, message: 'Logout registrado.' })
})
