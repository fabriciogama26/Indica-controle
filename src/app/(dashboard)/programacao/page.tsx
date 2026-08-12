import { redirect } from "next/navigation";

// C6 do corte: a Programacao principal passou a ser a Normalizada. A rota antiga
// `/programacao` continua existindo so como atalho historico (links salvos,
// favoritos) e agora aponta para a tela nova.
export default function ProgramacaoPage() {
  redirect("/programacao-normalizada");
}
