import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

/**
 * Camada de infraestrutura do DOCX. NAO conhece Permissao de Intervencao, nem
 * nenhum outro dominio: recebe o buffer de um `.docx` e um dicionario de
 * strings, devolve o buffer preenchido.
 *
 * O `.docx` e um ZIP com o texto em XML comprimido em deflate. Nao existe
 * "trocar o texto direto no arquivo": e obrigatorio descompactar, substituir no
 * XML e recompactar. O arquivo de origem nunca e alterado — tudo acontece sobre
 * copias em memoria.
 *
 * Por que docxtemplater e nao substituicao propria no render: o Word quebra um
 * mesmo trecho de texto em varios `<w:r>` quando houve qualquer edicao no meio
 * dele. No template da PI isso e real — no cabecalho, `{pi_code}` esta partido
 * em tres pedacos com um `<w:proofErr>` entre eles. Substituicao ingenua por
 * regex nao acha a tag; o docxtemplater normaliza os runs do paragrafo antes de
 * casar.
 */

/** Assinatura local de um arquivo ZIP (`PK\x03\x04`), primeiros 4 bytes. */
const ZIP_LOCAL_FILE_HEADER = "504b0304";

/**
 * Partes do pacote que carregam texto templatizavel. Cabecalho e rodape entram
 * porque o docxtemplater tambem os renderiza — e no template da PI o codigo e o
 * projeto vivem SO no cabecalho, repetidos nas tres secoes do documento.
 */
const TEMPLATED_PART_PATTERN = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

/**
 * Qualquer conteudo entre chaves, sem aninhamento.
 *
 * Deliberadamente amplo: um template com `{#loop}`, `{%imagem}` ou um erro de
 * digitacao precisa ser DETECTADO para que a checagem de contrato o recuse. Um
 * padrao restrito a identificadores deixaria essas formas passarem em silencio.
 */
const TAG_PATTERN = /\{([^{}]{1,60})\}/g;

export type DocxTemplateFailure = {
  code: "NOT_A_ZIP" | "INVALID_DOCX" | "RENDER_FAILED";
  message: string;
  /** Mensagens cruas do docxtemplater, uma por tag/parte com problema. */
  details: string[];
};

export type DocxTemplateResult<T> = { ok: true; value: T } | { ok: false; error: DocxTemplateFailure };

/** `true` quando o buffer comeca com a assinatura de ZIP. Barreira barata contra arquivo trocado. */
export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString("hex") === ZIP_LOCAL_FILE_HEADER;
}

/**
 * Extrai as mensagens uteis de um erro do docxtemplater.
 *
 * A biblioteca agrega varias falhas em `properties.errors`, e a mensagem do
 * topo e sempre generica ("Multi error"). Sem descer um nivel, o usuario
 * receberia "Multi error" e nenhuma pista de qual tag quebrou.
 */
function describeDocxError(error: unknown): string[] {
  if (!(error instanceof Error)) return [String(error)];

  const nested = (error as { properties?: { errors?: unknown[] } }).properties?.errors;
  if (Array.isArray(nested) && nested.length > 0) {
    return nested.map((item) => {
      if (!(item instanceof Error)) return String(item);
      const explanation = (item as { properties?: { explanation?: string } }).properties?.explanation;
      return explanation ? `${item.message}: ${explanation}` : item.message;
    });
  }

  return [error.message];
}

function openZip(buffer: Buffer): DocxTemplateResult<PizZip> {
  if (!isZipBuffer(buffer)) {
    return {
      ok: false,
      error: { code: "NOT_A_ZIP", message: "O arquivo enviado nao e um .docx valido.", details: [] },
    };
  }

  try {
    return { ok: true, value: new PizZip(buffer) };
  } catch (error) {
    return {
      ok: false,
      error: { code: "INVALID_DOCX", message: "Nao foi possivel abrir o .docx.", details: describeDocxError(error) },
    };
  }
}

/**
 * Texto visivel de uma parte do pacote: so o conteudo dos nos `<w:t>`,
 * concatenado na ordem do documento.
 *
 * E essa concatenacao que remonta a tag quebrada em varios runs. Verificado
 * contra o template real da PI: os tres `{pi_code}` dos cabecalhos, que no XML
 * estao partidos em `{` + `pi_code` + `}` com um `<w:proofErr>` no meio, saem
 * inteiros por aqui.
 */
function extractPartText(xml: string): string {
  const matches = xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g);
  return Array.from(matches, (match) => match[1])
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Percorre as partes templatizaveis do pacote aplicando `TAG_PATTERN`. */
function collectTags(zip: PizZip): string[] {
  const found = new Set<string>();
  for (const partName of Object.keys(zip.files)) {
    if (!TEMPLATED_PART_PATTERN.test(partName)) continue;
    const part = zip.file(partName);
    if (!part) continue;
    for (const match of extractPartText(part.asText()).matchAll(TAG_PATTERN)) {
      const tag = match[1].trim();
      if (tag) found.add(tag);
    }
  }
  return Array.from(found).sort();
}

/**
 * Lista as tags declaradas no template, sem as chaves.
 *
 * NAO usa o `InspectModule` que acompanha o docxtemplater: aquele arquivo
 * (`docxtemplater/js/inspect-module.js`) faz `require("lodash")`, e `lodash`
 * nao esta declarado nas dependencias do pacote — importa-lo exigiria adicionar
 * uma dependencia so para inspecionar template. A extracao propria acima
 * resolve o mesmo caso, incluindo a tag partida em runs, e foi conferida contra
 * o template real.
 */
export function listDocxTemplateTags(buffer: Buffer): DocxTemplateResult<string[]> {
  const zip = openZip(buffer);
  if (!zip.ok) return zip;
  return { ok: true, value: collectTags(zip.value) };
}

/**
 * Copia o template e preenche as tags.
 *
 * `linebreaks: true` faz o `\n` de um valor virar quebra de linha real no Word,
 * necessario nos campos multilinha (atividades, plano de emergencia, transito,
 * observacoes). Sem isso o texto sai numa linha so.
 *
 * `nullGetter` devolve string vazia. O padrao da biblioteca e escrever
 * `undefined` no documento, o que imprimiria a palavra "undefined" no lugar de
 * um campo em branco.
 */
export function renderDocxTemplate(buffer: Buffer, data: Record<string, string>): DocxTemplateResult<Buffer> {
  const zip = openZip(buffer);
  if (!zip.ok) return zip;

  try {
    const doc = new Docxtemplater(zip.value, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    doc.render(data);
    return { ok: true, value: doc.toBuffer({ compression: "DEFLATE" }) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "RENDER_FAILED",
        message: "Falha ao preencher o template do documento.",
        details: describeDocxError(error),
      },
    };
  }
}

/**
 * Varre um DOCX ja renderizado e devolve as tags que sobraram, com as chaves.
 *
 * Ultima barreira antes de entregar o arquivo: uma tag que sobra sai impressa
 * como `{manager_name}` no documento oficial, e isso nao pode chegar ao campo.
 * A varredura le o RESULTADO, nao o template, justamente para pegar tambem o
 * caso de a tag existir no arquivo e o mapper ter esquecido de alimenta-la.
 */
export function findUnresolvedDocxTags(buffer: Buffer): DocxTemplateResult<string[]> {
  const zip = openZip(buffer);
  if (!zip.ok) return zip;
  return { ok: true, value: collectTags(zip.value).map((tag) => `{${tag}}`) };
}
