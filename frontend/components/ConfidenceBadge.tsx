import clsx from "clsx";
import type { ChatDecision } from "@/lib/types";

const LABELS: Record<ChatDecision, string> = {
  auto_answer: "Resposta automática",
  suggest_ticket: "Sugestão de chamado",
  auto_ticket: "Confirmação de chamado necessária",
};

const STYLES: Record<ChatDecision, string> = {
  auto_answer: "bg-emerald-100 text-emerald-700",
  suggest_ticket: "bg-amber-100 text-amber-700",
  auto_ticket: "bg-red-100 text-red-700",
};

export default function ConfidenceBadge({ decision, score }: { decision: ChatDecision; score: number }) {
  return (
    <span className={clsx("badge", STYLES[decision])}>
      {LABELS[decision]} · {(score * 100).toFixed(0)}% de confiança
    </span>
  );
}
