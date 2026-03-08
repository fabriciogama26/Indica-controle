import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function CadastroBasePage() {
  return (
    <ModulePlaceholder
      title="Cadastro Base"
      description="Modulo indice dos cadastros estruturantes do SaaS."
      nextSteps={[
        "Abrir atalhos para Pessoas e Materiais.",
        "Padronizar cards e filtros retrateis.",
        "Conectar cada modulo ao tenant autenticado.",
      ]}
    />
  );
}
