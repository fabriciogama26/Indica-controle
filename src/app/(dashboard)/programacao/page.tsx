import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function ProgramacaoPage() {
  return (
    <ModulePlaceholder
      title="Programacao"
      description="Tela reservada para planejamento e programacao das operacoes."
      nextSteps={[
        "Definir agenda operacional por projeto e recurso.",
        "Controlar prioridades e conflitos de programacao.",
        "Integrar com os modulos de entrada e saida.",
      ]}
    />
  );
}
