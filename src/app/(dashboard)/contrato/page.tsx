import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function ContratoPage() {
  return (
    <ModulePlaceholder
      title="Contrato"
      description="Tela reservada para consulta e manutencao de contratos do tenant."
      nextSteps={[
        "Listar contratos ativos com filtros basicos.",
        "Permitir ajustes de dados contratuais.",
        "Integrar contratos aos modulos de Projetos e Medicao.",
      ]}
    />
  );
}
