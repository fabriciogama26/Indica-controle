"use client";

// Filtros exclusivos da Medicao Comercial: `Incidencia` e `Eletricista`.
//
// Vivem fora do `MeasurementPageView` pelo mesmo motivo do
// `CommercialOrderRefField`: o PageView e legado e esta no ratchet de tamanho
// (guia_frontend.md, regra 15). Sao os unicos filtros que so fazem sentido na
// variante comercial -- ordem tecnica nao tem Incidencia nem integrantes.

import type { CommercialElectricianOption } from "./CommercialMembersFields";

export type CommercialFilterValue = {
  commercialOrderRef: string;
  commercialMember: string;
};

export const EMPTY_COMMERCIAL_FILTERS: CommercialFilterValue = {
  commercialOrderRef: "",
  commercialMember: "",
};

const ELECTRICIAN_FILTER_LIST_ID = "medicao-comercial-eletricista-filtro-list";

type CommercialFilterFieldsProps = {
  value: CommercialFilterValue;
  onChange: (next: Partial<CommercialFilterValue>) => void;
  fieldClassName: string;
  electricians: CommercialElectricianOption[];
};

export function CommercialFilterFields({
  value,
  onChange,
  fieldClassName,
  electricians,
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
    </>
  );
}
