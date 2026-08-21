import clsx from "clsx";
import type { TicketDetail, TicketHistoryEntry } from "@/lib/types";

/** Ações que são eventos de fluxo (mudança de estado do chamado), não fala de
 *  alguém — renderizadas como marcador discreto na timeline, não como bolha. */
const EVENT_LABELS: Record<string, string> = {
  criado: "Chamado aberto",
  assumido: "Chamado assumido",
  transferido: "Chamado transferido",
  prioridade_alterada: "Prioridade alterada",
  status_alterado: "Status alterado",
  resolvido: "Marcado como resolvido",
  encerrado: "Chamado encerrado",
};

function timestamp(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function TimelineEvent({ entry }: { entry: TicketHistoryEntry }) {
  const label = EVENT_LABELS[entry.action] ?? entry.action.replace(/_/g, " ");
  return (
    <div className="flex items-center gap-3 py-1 text-xs text-slate-400">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="shrink-0">
        {label}
        {entry.comment && <span className="text-slate-500"> — {entry.comment}</span>}
        {entry.actor_name && <span> · {entry.actor_name}</span>} · {timestamp(entry.created_at)}
      </span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function MessageBubble({
  author,
  at,
  body,
  variant,
}: {
  author: string;
  at: string;
  body: string;
  variant: "requester" | "staff" | "internal";
}) {
  const isRequester = variant === "requester";
  return (
    <div className={clsx("flex flex-col gap-1", isRequester ? "items-start" : "items-end")}>
      <div className="flex items-baseline gap-2 px-1 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{author}</span>
        {variant === "internal" && (
          <span className="badge bg-amber-100 text-amber-900">🔒 Nota interna</span>
        )}
        <span>{at}</span>
      </div>
      <div
        className={clsx(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm",
          variant === "requester" && "rounded-bl-sm bg-slate-100 text-slate-800",
          // brand-700 e não brand-500/600: só a partir do 700 o texto branco
          // atinge o contraste mínimo WCAG AA (5.13:1 vs. 2.72:1 no 500).
          variant === "staff" && "rounded-br-sm bg-brand-700 text-white",
          variant === "internal" &&
            "rounded-br-sm border border-dashed border-amber-300 bg-amber-50 text-amber-950",
        )}
      >
        {body}
      </div>
    </div>
  );
}

export default function TicketConversation({ ticket }: { ticket: TicketDetail }) {
  return (
    <div className="space-y-4">
      {/* A descrição original é a primeira fala do colaborador. Quando o
          chamado nasceu do chat com a IA, ela já carrega a pergunta e a
          resposta que a IA deu — contexto que o analista precisa ver antes
          de responder. */}
      <MessageBubble
        author={ticket.requester_name ?? "Colaborador"}
        at={timestamp(ticket.created_at)}
        body={ticket.description}
        variant="requester"
      />

      {ticket.history.map((entry) => {
        const isMessage = entry.action === "comentario" || entry.action === "nota_interna";
        if (!isMessage) return <TimelineEvent key={entry.id} entry={entry} />;

        const variant = entry.is_internal
          ? "internal"
          : entry.actor_id === ticket.requester_id
            ? "requester"
            : "staff";

        return (
          <MessageBubble
            key={entry.id}
            author={entry.actor_name ?? "Usuário removido"}
            at={timestamp(entry.created_at)}
            body={entry.comment ?? ""}
            variant={variant}
          />
        );
      })}
    </div>
  );
}
