import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type ContractCsvItem = {
  name: string;
  numeroContrato: string | null;
  empresa: string | null;
  nomeGestor: string | null;
  email: string | null;
  telefoneCorporativo: string | null;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

function formatOptionalText(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || "-";
}

export function buildContractsCsv(contracts: ContractCsvItem[]) {
  return buildCsvContent(
    [
      "Nome",
      "N. de Contrato",
      "Empresa",
      "Gestor",
      "E-mail",
      "Telefone corporativo",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    contracts.map((contract) => [
      contract.name,
      formatOptionalText(contract.numeroContrato),
      formatOptionalText(contract.empresa),
      formatOptionalText(contract.nomeGestor),
      formatOptionalText(contract.email),
      formatOptionalText(contract.telefoneCorporativo),
      contract.isActive ? "Ativo" : "Inativo",
      formatAuditActor(contract.createdByName),
      formatDateTime(contract.createdAt),
      formatAuditActor(contract.updatedByName),
      formatDateTime(contract.updatedAt),
    ]),
  );
}
