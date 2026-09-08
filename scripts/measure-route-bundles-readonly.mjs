// Mede o JS baixado por rota numa carga fria, a partir de um build ja gerado.
//
// Responde ao item W2.1 de `Auditoria/13-web-vitals.md`. Existe porque o
// `next build` com Turbopack (Next 16) NAO imprime mais a tabela de
// "First Load JS" por rota, e o `build-manifest.json` da raiz e o manifesto do
// Pages Router -- num app App Router ele devolve o mesmo conjunto compartilhado
// para todas as rotas, que foi o motivo de a medicao ter falhado antes.
//
// A fonte usada aqui e o HTML pre-renderizado de cada rota em
// `.next/server/app/*.html`: os `/_next/static/...js` que ele referencia sao
// exatamente os chunks que o navegador busca antes da hidratacao.
//
// Somente leitura: nao escreve em `.next`, banco, rede ou `src/`.
//
// Uso:
//   npm run build
//   node scripts/measure-route-bundles-readonly.mjs
//   node scripts/measure-route-bundles-readonly.mjs --baseline   (composicao do tronco comum)

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const APP_DIR = path.join(".next", "server", "app");
const STATIC_DIR = path.join(".next", "static");

// Pseudo-rotas: nao sao telas e distorceriam o tronco comum, porque nao
// carregam o mesmo conjunto de providers das rotas reais.
const IGNORED = new Set(["_global-error.html", "_not-found.html"]);

// Referencias a chunk dentro do HTML pre-renderizado: `src=`, `href=` de preload
// e os payloads de hidratacao. Para de casar no primeiro caractere que nao pode
// fazer parte de uma URL -- aspas, barra invertida, parentese ou espaco.
const CHUNK_REF = /\/_next\/static\/([^"'\\)\s]+?\.js)/g;

// Bibliotecas procuradas por assinatura textual dentro do chunk. A lista existe
// para atribuir peso a um culpado, nao para inventariar dependencias.
const LIBRARY_PROBES = [
  "react-dom", "scheduler", "@tanstack", "react-query", "recharts", "d3-",
  "xlsx", "jspdf", "leaflet", "maplibre", "mapbox", "date-fns", "dayjs",
  "moment", "lodash", "zod", "@supabase", "supabase-js", "@floating-ui",
  "framer-motion", "lucide", "exceljs", "file-saver", "papaparse", "react-select",
];

const kb = (bytes) => (bytes / 1024).toFixed(1);

function requireBuild() {
  if (!fs.existsSync(APP_DIR)) {
    console.error(`Build nao encontrado em ${APP_DIR}. Rode 'npm run build' antes.`);
    process.exit(1);
  }
}

const sizeCache = new Map();
function measureChunk(relativePath) {
  if (sizeCache.has(relativePath)) return sizeCache.get(relativePath);
  let result = { raw: 0, gzip: 0 };
  try {
    const buffer = fs.readFileSync(path.join(STATIC_DIR, relativePath));
    result = { raw: buffer.length, gzip: zlib.gzipSync(buffer, { level: 9 }).length };
  } catch {
    // Chunk referenciado no HTML mas ausente do disco: conta como zero e
    // aparece na contagem de chunks, sem derrubar a medicao inteira.
  }
  sizeCache.set(relativePath, result);
  return result;
}

// `index.html` e a rota raiz: sai como "/", nao como "/index".
function routeNameOf(file) {
  return "/" + file.replace(/\.html$/, "").replace(/^index$/, "");
}

function collectRoutes() {
  const files = fs.readdirSync(APP_DIR).filter((f) => f.endsWith(".html") && !IGNORED.has(f));
  const byRoute = new Map();
  const routesPerChunk = new Map();

  for (const file of files) {
    const html = fs.readFileSync(path.join(APP_DIR, file), "utf8");
    const chunks = new Set([...html.matchAll(CHUNK_REF)].map((m) => m[1]));
    byRoute.set(file, chunks);
    for (const chunk of chunks) routesPerChunk.set(chunk, (routesPerChunk.get(chunk) || 0) + 1);
  }

  // Tronco comum = chunk presente em TODAS as rotas reais. E o piso que
  // nenhuma tela consegue evitar, e por isso o unico alvo com ganho global.
  const trunk = [...routesPerChunk]
    .filter(([, count]) => count === files.length)
    .map(([chunk]) => chunk);

  return { files, byRoute, trunk };
}

function reportRoutes({ files, byRoute, trunk }) {
  const trunkRaw = trunk.reduce((sum, c) => sum + measureChunk(c).raw, 0);
  const trunkGzip = trunk.reduce((sum, c) => sum + measureChunk(c).gzip, 0);

  const rows = [];
  for (const [file, chunks] of byRoute) {
    let raw = 0, gzip = 0;
    for (const chunk of chunks) {
      const size = measureChunk(chunk);
      raw += size.raw;
      gzip += size.gzip;
    }
    rows.push({ route: routeNameOf(file), raw, gzip, delta: gzip - trunkGzip, chunks: chunks.size });
  }
  rows.sort((a, b) => b.gzip - a.gzip);

  console.log(`rotas medidas: ${files.length}`);
  console.log(`tronco comum: ${trunk.length} chunks = ${kb(trunkGzip)} kB gzip / ${kb(trunkRaw)} kB cru`);
  console.log("");
  console.log("ROTA".padEnd(34) + "GZIP_kB".padStart(9) + "CRU_kB".padStart(9) + "DELTA_GZ".padStart(10) + "CHK".padStart(5));
  for (const r of rows) {
    console.log(
      r.route.padEnd(34) + kb(r.gzip).padStart(9) + kb(r.raw).padStart(9) +
      `+${kb(r.delta)}`.padStart(10) + String(r.chunks).padStart(5),
    );
  }

  const maior = rows[0];
  const menor = rows[rows.length - 1];
  console.log("");
  console.log(`amplitude entre a maior e a menor rota: ${kb(maior.gzip - menor.gzip)} kB gzip (${maior.route} x ${menor.route})`);
  console.log(`fracao do tronco comum na rota mais pesada: ${((trunkGzip / maior.gzip) * 100).toFixed(1)}%`);
}

function reportBaseline({ trunk }) {
  const rows = trunk.map((chunk) => {
    const buffer = fs.readFileSync(path.join(STATIC_DIR, chunk));
    const text = buffer.toString("utf8");
    return {
      chunk: path.basename(chunk),
      raw: buffer.length,
      gzip: zlib.gzipSync(buffer, { level: 9 }).length,
      libs: LIBRARY_PROBES.filter((probe) => text.includes(probe)),
    };
  });
  rows.sort((a, b) => b.gzip - a.gzip);

  console.log("Composicao do tronco comum (presente em todas as rotas)");
  console.log("");
  console.log("CHUNK".padEnd(28) + "GZIP_kB".padStart(9) + "CRU_kB".padStart(9) + "  BIBLIOTECAS DETECTADAS");
  for (const r of rows) {
    console.log(r.chunk.padEnd(28) + kb(r.gzip).padStart(9) + kb(r.raw).padStart(9) + "  " + (r.libs.join(", ") || "-"));
  }
  console.log("");
  console.log(`total: ${kb(rows.reduce((s, r) => s + r.gzip, 0))} kB gzip / ${kb(rows.reduce((s, r) => s + r.raw, 0))} kB cru`);
}

requireBuild();
const data = collectRoutes();
if (process.argv.includes("--baseline")) reportBaseline(data);
else reportRoutes(data);
