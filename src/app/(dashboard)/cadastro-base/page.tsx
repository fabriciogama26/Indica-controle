import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function CadastroBasePage() {
  return (
    <ModulePlaceholder
      title="Cadastro Base"
      description="Modulo indice dos cadastros estruturantes usados pelos demais fluxos."
      nextSteps={[
        "Consolidar atalhos de Prioridade, Centro de Servico, Contrato, Atividades, Imei e Tipo de Servico.",
        "Padronizar atalhos para Nivel de Tensao, Porte, Responsavel Distribuidora e Municipio.",
        "Garantir persistencia multi-tenant dos dominios base.",
      ]}
    />
  );
}
