import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function ResponsavelDistribuidoraPage() {
  return (
    <ModulePlaceholder
      title="Responsavel Distribuidora"
      description="Tela reservada para cadastro base de responsaveis da distribuidora."
      nextSteps={[
        "Listar responsaveis por tenant.",
        "Permitir cadastro e vinculacao com dados de contato.",
        "Integrar com Projetos e fluxos operacionais.",
      ]}
    />
  );
}
