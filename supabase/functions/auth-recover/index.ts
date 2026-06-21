// Edge Function: auth-recover
// Resolve login_name -> email e dispara reset de senha.
// Requer variaveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PASSWORD_REDIRECT_URL (opcional).

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
const redirectTo = (Deno.env.get('PASSWORD_REDIRECT_URL') ?? '').trim()
const debugAuthRecover = (Deno.env.get('AUTH_RECOVER_DEBUG') ?? '').trim() === 'true'

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
    return respond(405, {
      error: { message: 'method_not_allowed', code: 'METHOD_NOT_ALLOWED' },
    })
  }

  const body = await req.json().catch(() => ({}))
  const loginName = normalizeLoginName(body.loginName ?? body.login_name ?? body.username)

  if (!loginName) {
    return respond(400, {
      error: {
        message: 'Informe seu login para recuperar a senha.',
        code: 'VALIDATION_ERROR',
      },
    })
  }

  const ip = getClientIp(req) || 'unknown'
  const identityHash = await sha256Hex(`${ip}|${loginName}`)
  const { data: rateData, error: rateError } = await supabase.rpc('rate_limit_check_and_hit', {
    p_scope: 'auth',
    p_route: 'auth.recover',
    p_identity_hash: identityHash,
    p_owner_id: null,
    p_ip_hash: null,
  })

  if (rateError) {
    return respond(500, {
      error: {
        message: 'Falha ao validar limite de requisicoes.',
        code: 'UPSTREAM_ERROR',
      },
    })
  }

  const rateResult = Array.isArray(rateData) ? rateData[0] : rateData
  if (rateResult?.allowed === false) {
    const retryAfterSeconds = Number(rateResult.retry_after) || 60
    return respond(
      429,
      {
        error: {
          message: `Limite de requisicoes excedido. Tente em ${retryAfterSeconds} segundos.`,
          code: 'RATE_LIMIT',
        },
      },
      { 'Retry-After': String(retryAfterSeconds) },
    )
  }

  const { data: userRow, error } = await supabase
    .from('app_users')
    .select('email')
    .eq('login_name', loginName)
    .maybeSingle()

  if (error) {
    return respond(500, {
      error: { message: 'Falha ao consultar login.', code: 'UPSTREAM_ERROR' },
    })
  }

  const email = String(userRow?.email ?? '').trim()
  if (userRow && !email) {
    return respond(422, {
      error: {
        message: 'Login sem email cadastrado. Procure um administrador.',
        code: 'MISSING_EMAIL',
      },
    })
  }

  if (!email) {
    return respond(200, { ok: true })
  }

  const options = redirectTo ? { redirectTo } : undefined
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, options)
  if (resetError) {
    console.error('auth-recover resetPasswordForEmail failed', {
      message: resetError.message,
      status: resetError.status,
      code: resetError.code,
    })

    return respond(500, {
      error: {
        message: 'Falha ao enviar email de recuperacao.',
        code: 'UPSTREAM_ERROR',
        ...(debugAuthRecover ? { details: resetError.message || String(resetError) } : {}),
      },
    })
  }

  return respond(200, { ok: true })
})
