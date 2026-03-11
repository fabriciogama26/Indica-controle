import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function PortePage() {
  return (
    <ModulePlaceholder
      title="Porte"
      description="Tela reservada para cadastro base de porte operacional."
      nextSteps={[
        "Listar portes disponiveis por tenant.",
        "Permitir cadastro e manutencao de classificacoes.",
        "Integrar o dominio ao cadastro de Projetos.",
      ]}
    />
  );
}
