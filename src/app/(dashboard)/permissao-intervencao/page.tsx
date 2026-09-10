import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function PermissaoIntervencaoPage() {
  return (
    <ModulePlaceholder
      title="Permissao de Intervencao"
      description="Cadastro da PI vinculada a Projeto + Data da etapa. O template Word ja esta pronto e fica em Cadastro Base > Modelo de PI."
      nextSteps={[
        "Schema da PI: identificacao, areas e tensoes, plano de execucao, historico e configuracao por contrato.",
        "Codigo automatico PI-RJ-[TENSAO]-[AREA]-INDICA-[SEQUENCIAL], com sequencial atomico atribuido na emissao.",
        "Nova PI a partir de uma etapa da Programacao, com os campos herdados e editaveis.",
        "Nova PI sem Programacao, com vinculo automatico quando a etapa daquela data for criada.",
        "Formulario completo, plano de execucao ordenavel e comparacao Programacao x PI.",
        "Geracao do documento a partir do template ativo do contrato.",
      ]}
    />
  );
}
