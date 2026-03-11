import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function PrioridadePage() {
  return (
    <ModulePlaceholder
      title="Prioridade"
      description="Tela reservada para cadastro base de prioridades operacionais."
      nextSteps={[
        "Listar prioridades por tenant.",
        "Padronizar sigla e descricao operacional.",
        "Integrar com o formulario de Projetos.",
      ]}
    />
  );
}
