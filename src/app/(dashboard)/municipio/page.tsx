import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function MunicipioPage() {
  return (
    <ModulePlaceholder
      title="Municipio"
      description="Tela reservada para cadastro base de municipios do tenant."
      nextSteps={[
        "Listar municipios cadastrados por tenant.",
        "Permitir cadastro e manutencao de municipios ativos.",
        "Integrar o dominio aos modulos de Projetos e Operacao.",
      ]}
    />
  );
}
