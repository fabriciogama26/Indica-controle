// _shared/xlsx.ts
// XLSX parsing utilities shared across import Edge Functions.

import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

export type ParsedRow = {
  line: number
  projectSob: string
  code: string
  qtyPlanned: number
}

export type ImportIssue = {
  line: number
  column: string
  value: string
  error: string
}

export const normalizeText = (value: unknown): string =>
  String(value ?? '').trim()

export const normalizeHeader = (value: unknown): string =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

export const parsePositiveNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }
  const raw = normalizeText(value)
  if (!raw) return null
  let normalized = raw.replace(/\s+/g, '')
  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = normalized.replace(/,/g, '')
    }
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.')
  }
  const numeric = Number(normalized)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

export const makeIssue = (
  line: number,
  column: string,
  value: unknown,
  error: string,
): ImportIssue => ({ line, column, value: normalizeText(value), error })

export function parseWorkbook(
  content: ArrayBuffer,
): { rows: ParsedRow[]; issues: ImportIssue[] } {
  const workbook = XLSX.read(content, { type: 'array', cellDates: false, raw: false })
  const firstSheetName = workbook.SheetNames[0]

  if (!firstSheetName) {
    return { rows: [], issues: [makeIssue(1, 'arquivo', '', 'Planilha XLSX sem abas.')] }
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false,
  })

  if (rawRows.length === 0) {
    return {
      rows: [],
      issues: [makeIssue(1, 'arquivo', '', 'Planilha vazia. Preencha ao menos uma linha.')],
    }
  }

  const firstRow = rawRows[0] ?? {}
  const normalizedToOriginal = new Map<string, string>()
  for (const key of Object.keys(firstRow)) {
    normalizedToOriginal.set(normalizeHeader(key), key)
  }

  const projectKey = normalizedToOriginal.get('projeto') ?? normalizedToOriginal.get('sob') ?? ''
  const codeKey = normalizedToOriginal.get('codigo') ?? ''
  const qtyKey = normalizedToOriginal.get('quantidade') ?? ''

  if (!projectKey || !codeKey || !qtyKey) {
    return {
      rows: [],
      issues: [
        makeIssue(
          1,
          'cabecalho',
          Object.keys(firstRow).join('; '),
          'Cabecalho invalido. Use o modelo oficial com as colunas: projeto, codigo, quantidade.',
        ),
      ],
    }
  }

  const rows: ParsedRow[] = []
  const issues: ImportIssue[] = []

  rawRows.forEach((row, index) => {
    const line = index + 2
    const projectSob = normalizeText(row[projectKey]).toUpperCase()
    const code = normalizeText(row[codeKey]).toUpperCase()
    const qty = parsePositiveNumber(row[qtyKey])

    if (!projectSob && !code && !normalizeText(row[qtyKey])) return

    if (!projectSob) issues.push(makeIssue(line, 'projeto', row[projectKey], 'Projeto obrigatorio.'))
    if (!code) issues.push(makeIssue(line, 'codigo', row[codeKey], 'Codigo obrigatorio.'))
    if (qty === null) issues.push(makeIssue(line, 'quantidade', row[qtyKey], 'Quantidade invalida.'))
    if (!projectSob || !code || qty === null) return

    rows.push({ line, projectSob, code, qtyPlanned: qty })
  })

  if (rows.length === 0 && issues.length === 0) {
    issues.push(makeIssue(1, 'arquivo', '', 'Nenhuma linha valida encontrada para importacao.'))
  }

  return { rows, issues }
}
