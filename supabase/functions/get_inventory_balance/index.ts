// Edge Function: get_inventory_balance
// Returns physical stock balance by material for the authenticated tenant.
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const respond = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders,
  })

const getBearerToken = (req: Request) => {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.substring(7).trim()
}

const normalizeText = (value: unknown) => String(value ?? '').trim()
const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const normalizeInt = (value: unknown, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback
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

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('tenant_id, ativo')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (appUserError || !appUser?.tenant_id || appUser.ativo === false) {
    return respond(403, { success: false, message: 'Usuario sem permissao para consultar estoque.' })
  }

  const body = await req.json().catch(() => ({}))
  const codigo = normalizeText(body.codigo)
  const descricao = normalizeText(body.descricao)
  const qtyExact = normalizeNumber(body.qty_exact)
  const qtyMin = normalizeNumber(body.qty_min)
  const qtyMax = normalizeNumber(body.qty_max)
  const limit = Math.min(normalizeInt(body.limit, 100), 500)
  const offset = normalizeInt(body.offset, 0)

  let query = supabase
    .from('inventory_balance')
    .select('material_id, qty_on_hand, updated_at, materials!inner(codigo, descricao, umb, tipo)', { count: 'exact' })
    .eq('tenant_id', appUser.tenant_id)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (codigo) query = query.ilike('materials.codigo', `%${codigo}%`)
  if (descricao) query = query.ilike('materials.descricao', `%${descricao}%`)
  if (qtyExact !== null) query = query.eq('qty_on_hand', qtyExact)
  if (qtyMin !== null) query = query.gte('qty_on_hand', qtyMin)
  if (qtyMax !== null) query = query.lte('qty_on_hand', qtyMax)

  const { data, error, count } = await query
  if (error) return respond(500, { success: false, message: 'Falha ao consultar estoque atual.' })

  return respond(200, {
    success: true,
    total: count ?? 0,
    items: data ?? [],
  })
})
