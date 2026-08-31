"use client";

import styles from "./ActivitiesPageView.module.css";

export type CatalogOption = {
  id: string;
  name: string;
};

type CatalogSelectFieldProps = {
  label: string;
  value: string;
  options: CatalogOption[];
  isLoading: boolean;
  onChange: (nextValue: string) => void;
};

/**
 * Campo `select` obrigatorio alimentado por catalogo do tenant.
 *
 * Os tres campos de catalogo do formulario de Atividades (`Tipo`, `Categoria` e
 * `Grupo`) tinham exatamente a mesma marcacao. `Grupo` era o unico ainda em
 * texto livre; ao virar catalogo na etapa 3, a repeticao passou a valer a
 * extracao — que tambem devolveu a `ActivitiesPageView` o espaco ocupado pelo
 * novo campo, mantendo o arquivo dentro do baseline do ratchet de tamanho.
 */
export function CatalogSelectField({ label, value, options, isLoading, onChange }: CatalogSelectFieldProps) {
  return (
    <label className={styles.field}>
      <span>
        {label} <span className="requiredMark">*</span>
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required disabled={isLoading}>
        <option value="" disabled>
          {isLoading ? "Carregando..." : "Selecione"}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
