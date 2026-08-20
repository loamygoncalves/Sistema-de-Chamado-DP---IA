import clsx from "clsx";
import type { TicketStatus, TicketPriority } from "@/lib/types";

const STATUS_LABELS: Record<TicketStatus, string> = {
  novo: "Novo",
  em_triagem: "Em triagem",
  em_atendimento: "Em atendimento",
  aguardando_usuario: "Aguardando usuário",
  resolvido: "Resolvido",
  encerrado: "Encerrado",
};

const STATUS_STYLES: Record<TicketStatus, string> = {
  novo: "bg-slate-100 text-slate-700",
  em_triagem: "bg-blue-100 text-blue-700",
  em_atendimento: "bg-indigo-100 text-indigo-700",
  aguardando_usuario: "bg-amber-100 text-amber-700",
  resolvido: "bg-emerald-100 text-emerald-700",
  encerrado: "bg-slate-200 text-slate-600",
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  baixa: "bg-slate-100 text-slate-600",
  media: "bg-blue-100 text-blue-700",
  alta: "bg-orange-100 text-orange-700",
  critica: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={clsx("badge", STATUS_STYLES[status])}>{STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return <span className={clsx("badge", PRIORITY_STYLES[priority])}>{PRIORITY_LABELS[priority]}</span>;
}
