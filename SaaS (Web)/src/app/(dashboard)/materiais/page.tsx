import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function MateriaisPage() {
  return (
    <ModulePlaceholder
      title="Materiais"
      description="Tela base para cadastro e consulta do catalogo de materiais."
      nextSteps={[
        "Listar materiais por tenant.",
        "Cadastrar codigo, descricao e status.",
        "Preparar integracao com estoque fisico.",
      ]}
    />
  );
}
