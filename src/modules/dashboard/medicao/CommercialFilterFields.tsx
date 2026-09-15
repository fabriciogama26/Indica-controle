"use client";

// Filtros exclusivos da Medicao Comercial: `Incidencia`, `Eletricista` e `Processo`.
//
// Vivem fora do `MeasurementPageView` pelo mesmo motivo do
// `CommercialOrderRefField`: o PageView e legado e esta no ratchet de tamanho
// (guia_frontend.md, regra 15). Sao os unicos filtros que so fazem sentido na
// variante comercial -- ordem tecnica nao tem Incidencia, integrantes nem Processo.

import type { CommercialElectricianOption } from "./CommercialMembersFields";

export type CommercialFilterValue = {
  commercialOrderRef: string;
  commercialMember: string;
  commercialProcessId: string;
};

export const EMPTY_COMMERCIAL_FILTERS: CommercialFilterValue = {
  commercialOrderRef: "",
  commercialMember: "",
  commercialProcessId: "",
};

// Monta a parte comercial da query string da listagem e da exportacao. Na tela
// tecnica os valores ficam sempre vazios, entao nenhum parametro e enviado.
export function appendCommercialFilterParams(params: URLSearchParams, filters: CommercialFilterValue) {
  if (filters.commercialOrderRef.trim()) params.set("commercialOrderRef", filters.commercialOrderRef.trim());
  if (filters.commercialMember.trim()) params.set("commercialMember", filters.commercialMember.trim());
  if (filters.commercialProcessId) params.set("commercialProcessId", filters.commercialProcessId);
}

const ELECTRICIAN_FILTER_LIST_ID = "medicao-comercial-eletricista-filtro-list";

type CommercialFilterFieldsProps = {
  value: CommercialFilterValue;
  onChange: (next: Partial<CommercialFilterValue>) => void;
  fieldClassName: string;
  electricians: CommercialElectricianOption[];
  processes: Array<{ id: string; name: string }>;
};

export function CommercialFilterFields({
  value,
  onChange,
  fieldClassName,
  electricians,
  processes,
}: CommercialFilterFieldsProps) {
  return (
    <>
      <label className={fieldClassName}>
        <span>Incidencia</span>
        <input
          value={value.commercialOrderRef}
          onChange={(event) => onChange({ commercialOrderRef: event.target.value })}
          placeholder="Digite a Incidencia ou parte dela"
          maxLength={120}
        />
      </label>
      <label className={fieldClassName}>
        <span>Eletricista</span>
        <input
          value={value.commercialMember}
          onChange={(event) => onChange({ commercialMember: event.target.value })}
          list={ELECTRICIAN_FILTER_LIST_ID}
          placeholder="Digite matricula ou nome"
          maxLength={120}
        />
        {/* A lista e atalho, nao trava: o servidor casa o texto por TRECHO em
            matricula OU nome, entao busca parcial e nome de quem ja saiu do
            cadastro de eletricistas ativos tambem funcionam. */}
        <datalist id={ELECTRICIAN_FILTER_LIST_ID}>
          {electricians.map((item) => (
            <option
              key={item.id}
              value={String(item.matriculation ?? "").trim() || item.name}
              label={item.name}
            />
          ))}
        </datalist>
      </label>
      <label className={fieldClassName}>
        <span>Processo</span>
        <select
          value={value.commercialProcessId}
          onChange={(event) => onChange({ commercialProcessId: event.target.value })}
        >
          <option value="">Todos</option>
          {processes.map((process) => (
            <option key={process.id} value={process.id}>{process.name}</option>
          ))}
        </select>
      </label>
    </>
  );
}
