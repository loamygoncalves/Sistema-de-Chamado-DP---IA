import clsx from "clsx";

/** Faixas iguais às do resto do sistema: verde no prazo, amarelo atenção
 *  (≤ 6h restantes), vermelho vencido. O prazo em si já vem do backend
 *  calculado em horas úteis (sem fim de semana/feriado). */
export function slaState(slaDueAt: string | null, closedAt: string | null) {
  if (!slaDueAt || closedAt) return { tone: "neutral" as const, label: "—" };

  const remainingMs = new Date(slaDueAt).getTime() - Date.now();
  if (remainingMs < 0) {
    return { tone: "critical" as const, label: `Vencido há ${formatDuration(-remainingMs)}` };
  }
  const tone = remainingMs <= 6 * 3600_000 ? ("warning" as const) : ("success" as const);
  return { tone, label: `${formatDuration(remainingMs)} restantes` };
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

const TONE_STYLES = {
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-900",
  critical: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-600",
} as const;

export default function SlaCountdown({
  slaDueAt,
  closedAt,
}: {
  slaDueAt: string | null;
  closedAt: string | null;
}) {
  const { tone, label } = slaState(slaDueAt, closedAt);
  return <span className={clsx("badge", TONE_STYLES[tone])}>{label}</span>;
}
