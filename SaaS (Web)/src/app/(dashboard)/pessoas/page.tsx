import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function PessoasPage() {
  return (
    <ModulePlaceholder
      title="Pessoas"
      description="Tela base para listagem, cadastro e manutencao de pessoas operacionais."
      nextSteps={[
        "Listar pessoas por tenant.",
        "Cadastrar e editar com status ativo.",
        "Preparar filtro por cargo e centro de servico.",
      ]}
    />
  );
}
