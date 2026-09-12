import type { ReactNode } from "react";

import styles from "./TableSkeleton.module.css";

type TableSkeletonRowsProps = {
  /** Colunas da tabela. Precisa bater com o `<thead>` da tela. */
  columns: number;
  /** Linhas do corpo. Aproximar da quantidade tipica da tela. */
  rows?: number;
};

/**
 * So as linhas do corpo, para telas cujo estado de carregamento ja vive DENTRO
 * de um `<tbody>` existente (o `<tr><td colSpan>Carregando...</td></tr>`).
 * Evita reestruturar a tabela da tela so para reservar altura.
 */
export function TableSkeletonRows({ columns, rows = 8 }: TableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }, (_, cellIndex) => (
            <td key={cellIndex}>
              <span className={styles.bar} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

type TableSkeletonProps = {
  /** Classe da tabela REAL da tela. E dela que vem a geometria (padding, line-height, bordas). */
  className: string;
  /** Cabecalhos reais, na mesma ordem da tabela. Use "" para colunas de acao sem titulo. */
  headers: ReactNode[];
  /** Linhas do corpo. Aproximar da quantidade tipica da tela. */
  rows?: number;
  /** Texto lido por leitor de tela enquanto carrega. */
  label?: string;
};

/**
 * Placeholder de tabela com a geometria da tabela real.
 *
 * Renderiza a MESMA estrutura (`table > thead/tbody`) com a MESMA classe da tela,
 * entao altura de linha, padding e bordas vem do CSS ja existente — nao de numeros
 * chutados aqui. Substitui o `<p>Carregando...</p>` de uma linha, que era a causa
 * de o conteudo abaixo deslocar quando os dados chegavam.
 */
export function TableSkeleton({
  className,
  headers,
  rows = 8,
  label = "Carregando...",
}: TableSkeletonProps) {
  return (
    <table className={className} aria-busy="true">
      <caption className={styles.srOnly}>{label}</caption>
      <thead>
        <tr>
          {headers.map((header, index) => (
            <th key={index}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <TableSkeletonRows columns={headers.length} rows={rows} />
      </tbody>
    </table>
  );
}
