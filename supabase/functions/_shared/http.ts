// _shared/http.ts
// HTTP utilities shared across Edge Functions.

// Origem permitida em CORS. O default continua '*' para nao quebrar deploy sem
// a secret configurada, mas o valor real deve vir de:
//   supabase secrets set ALLOWED_ORIGIN="https://seu-dominio"
const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? '*'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  // Sem Vary, um cache intermediario pode servir a uma origem a resposta
  // liberada para outra.
  Vary: 'Origin',
}

// Mesma politica de origem, para as funcoes que tambem respondem GET.
// Existe para que nenhuma funcao precise redeclarar o bloco inteiro so por
// causa do verbo -- era assim que 14 funcoes acabavam com 'Origin: *' fixo,
// ignorando ALLOWED_ORIGIN.
export const corsHeadersFor = (methods: string): Record<string, string> => ({
  ...corsHeaders,
  'Access-Control-Allow-Methods': methods,
})

export const respond = (
  status: number,
  payload: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, ...extraHeaders },
  })

export const getBearerToken = (req: Request): string => {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.substring(7).trim()
}
