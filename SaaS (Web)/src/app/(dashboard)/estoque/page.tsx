import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function EstoquePage() {
  return (
    <ModulePlaceholder
      title="Estoque Atual"
      description="Tela reservada para consulta do saldo fisico por centro de estoque."
      nextSteps={[
        "Aplicar filtros por centro, codigo e descricao.",
        "Conectar ao get_inventory_balance.",
        "Adicionar paginacao e resumo por material.",
      ]}
    />
  );
}
