"use client";

// Os dois eletricistas da ordem de Medicao Comercial.
//
// Fica em componente proprio para que a variante comercial nao engorde o
// PageView da Medicao, que ja esta acima do teto de linhas do CLAUDE.md.
//
// Os integrantes NAO sao deduzidos da equipe: sao escolhidos a cada ordem a
// partir do cadastro de Pessoas (cargo Eletricista), que e a razao de existir a
// categoria COMERCIAL -- equipe comercial nao tem vinculo fixo com pessoas.

export type CommercialElectricianOption = {
  id: string;
  name: string;
};

export type CommercialMembersValue = {
  employee1Id: string;
  employee2Id: string;
};

type CommercialMembersFieldsProps = {
  electricians: CommercialElectricianOption[];
  value: CommercialMembersValue;
  onChange: (next: CommercialMembersValue) => void;
  fieldClassName: string;
  disabled?: boolean;
};

export const EMPTY_COMMERCIAL_MEMBERS: CommercialMembersValue = {
  employee1Id: "",
  employee2Id: "",
};

export function validateCommercialMembers(value: CommercialMembersValue) {
  if (!value.employee1Id || !value.employee2Id) {
    return "Selecione os dois eletricistas da medicao comercial.";
  }
  if (value.employee1Id === value.employee2Id) {
    return "Os dois integrantes da medicao comercial devem ser diferentes.";
  }
  return null;
}

function MemberSelect(props: {
  label: string;
  selected: string;
  otherSelected: string;
  electricians: CommercialElectricianOption[];
  onSelect: (personId: string) => void;
  fieldClassName: string;
  disabled?: boolean;
}) {
  return (
    <label className={props.fieldClassName}>
      <span>
        {props.label} <span className="requiredMark">*</span>
      </span>
      <select value={props.selected} onChange={(event) => props.onSelect(event.target.value)} disabled={props.disabled}>
        <option value="">Selecione</option>
        {props.electricians
          // O ja escolhido no outro campo some daqui, mas continua listado
          // quando e o valor deste campo — senao a edicao de uma ordem salva
          // abriria com o select vazio.
          .filter((item) => item.id === props.selected || item.id !== props.otherSelected)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
      </select>
    </label>
  );
}

export function CommercialMembersFields({
  electricians,
  value,
  onChange,
  fieldClassName,
  disabled,
}: CommercialMembersFieldsProps) {
  return (
    <>
      <MemberSelect
        label="Eletricista 1"
        selected={value.employee1Id}
        otherSelected={value.employee2Id}
        electricians={electricians}
        onSelect={(personId) => onChange({ ...value, employee1Id: personId })}
        fieldClassName={fieldClassName}
        disabled={disabled}
      />
      <MemberSelect
        label="Eletricista 2"
        selected={value.employee2Id}
        otherSelected={value.employee1Id}
        electricians={electricians}
        onSelect={(personId) => onChange({ ...value, employee2Id: personId })}
        fieldClassName={fieldClassName}
        disabled={disabled}
      />
    </>
  );
}

export function formatCommercialMembers(members: Array<{ name: string }> | undefined) {
  const names = (members ?? []).map((item) => String(item.name ?? "").trim()).filter(Boolean);
  return names.length ? names.join(" / ") : "Sem integrantes";
}
