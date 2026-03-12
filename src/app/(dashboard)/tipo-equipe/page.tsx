import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function TipoEquipePage() {
  return (
    <ModulePlaceholder
      title="Tipo de Equipe"
      description="Tela reservada para cadastro base de tipos de equipes do tenant."
      nextSteps={[
        "Listar tipos de equipe ativos e inativos por tenant.",
        "Permitir cadastro e edicao com validacao de duplicidade.",
        "Integrar os tipos no cadastro de Equipes.",
      ]}
    />
  );
}
