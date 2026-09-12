import type { NextConfig } from "next";

/**
 * Origem do projeto Supabase, usada nas diretivas `connect-src` da CSP.
 * Lida em tempo de build; se a variavel nao existir, a diretiva simplesmente
 * nao ganha o host e a CSP continua valida (o Report-Only apenas reportaria).
 */
function supabaseOrigins() {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!raw) return [];

  try {
    const { origin, host } = new URL(raw);
    // Realtime usa websocket no mesmo host.
    return [origin, `wss://${host}`];
  } catch {
    return [];
  }
}

/**
 * CSP dividida em duas: a parte que ja pode bloquear sem risco de quebrar a
 * aplicacao vai no header normal; a politica completa vai em Report-Only ate
 * que os scripts inline do Next passem a usar nonce.
 *
 * `frame-ancestors 'none'` e o controle real contra clickjacking — o
 * X-Frame-Options abaixo existe so para navegador legado.
 */
const enforcedCsp = ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join(
  "; ",
);

const reportOnlyCsp = [
  "default-src 'self'",
  // Next injeta script inline no bootstrap; sem nonce, 'unsafe-inline' e necessario.
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${["'self'", ...supabaseOrigins(), "https://vitals.vercel-insights.com"].join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: enforcedCsp },
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Nao anunciar o framework/versao na resposta.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
