import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function CentroServicoPage() {
  return (
    <ModulePlaceholder
      title="Centro de Servico"
      description="Tela reservada para cadastro base de centros de servico do tenant."
      nextSteps={[
        "Listar centros de servico por tenant.",
        "Permitir cadastro, edicao e inativacao.",
        "Integrar com os modulos de Operacao e Estoque.",
      ]}
    />
  );
}
