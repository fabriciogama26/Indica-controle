"use client";

import { useEffect, useMemo, useState } from "react";

export type CommercialElectricianOption = {
  id: string;
  name: string;
  matriculation?: string | null;
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

function normalizeLookup(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function electricianOptionLabel(item: CommercialElectricianOption) {
  const matriculation = String(item.matriculation ?? "").trim();
  return matriculation ? `${matriculation} - ${item.name}` : item.name;
}

function findElectricianOption(input: string, electricians: CommercialElectricianOption[]) {
  const normalized = normalizeLookup(input);
  if (!normalized) {
    return null;
  }

  return electricians.find((item) => {
    const label = normalizeLookup(electricianOptionLabel(item));
    const name = normalizeLookup(item.name);
    const matriculation = normalizeLookup(item.matriculation);
    return item.id === input || label === normalized || name === normalized || matriculation === normalized;
  }) ?? null;
}

function MemberInput(props: {
  label: string;
  selected: string;
  otherSelected: string;
  electricians: CommercialElectricianOption[];
  onSelect: (personId: string) => void;
  fieldClassName: string;
  disabled?: boolean;
}) {
  const availableElectricians = useMemo(
    () => props.electricians.filter((item) => item.id === props.selected || item.id !== props.otherSelected),
    [props.electricians, props.otherSelected, props.selected],
  );
  const selectedOption = props.electricians.find((item) => item.id === props.selected) ?? null;
  const selectedLabel = selectedOption ? electricianOptionLabel(selectedOption) : "";
  const [search, setSearch] = useState("");
  const listId = `medicao-comercial-${props.label.toLowerCase().replace(/\s+/g, "-")}-list`;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setSearch(selectedLabel);
      }
    });
    return () => {
      active = false;
    };
  }, [selectedLabel]);

  return (
    <label className={props.fieldClassName}>
      <span>
        {props.label} <span className="requiredMark">*</span>
      </span>
      <input
        value={search}
        onChange={(event) => {
          const nextValue = event.target.value;
          setSearch(nextValue);
          props.onSelect(findElectricianOption(nextValue, availableElectricians)?.id ?? "");
        }}
        list={listId}
        placeholder="Digite matricula ou nome"
        disabled={props.disabled}
      />
      <datalist id={listId}>
        {availableElectricians.map((item) => (
          <option key={item.id} value={electricianOptionLabel(item)} />
        ))}
      </datalist>
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
      <MemberInput
        label="Eletricista 1"
        selected={value.employee1Id}
        otherSelected={value.employee2Id}
        electricians={electricians}
        onSelect={(personId) => onChange({ ...value, employee1Id: personId })}
        fieldClassName={fieldClassName}
        disabled={disabled}
      />
      <MemberInput
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
