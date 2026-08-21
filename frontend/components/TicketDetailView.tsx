"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { TicketDetail } from "@/lib/types";
import { PriorityBadge, StatusBadge } from "@/components/TicketStatusBadge";
import SlaCountdown from "@/components/SlaCountdown";
import TicketConversation from "@/components/TicketConversation";

/** Visão do colaborador sobre o próprio chamado: acompanha a conversa,
 *  responde ao analista e avalia o atendimento no fim. As ações de
 *  atendimento (assumir, transferir, mudar status/prioridade) ficam na tela do
 *  analista — ver `AnalystTicketWorkspace`. */
export default function TicketDetailView({ ticketId }: { ticketId: string }) {
  const { user } = useAuth();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState(5);
  const [rated, setRated] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setTicket(await api.get<TicketDetail>(`/tickets/${ticketId}`));
  }, [ticketId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!ticket || !user) return <p className="text-slate-500">Carregando chamado...</p>;

  const isOwner = ticket.requester_id === user.id;

  async function withBusy(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-slate-500">{ticket.ticket_number}</p>
            <h1 className="text-lg font-semibold">{ticket.subject}</h1>
            <p className="mt-1 text-xs text-slate-500">
              Aberto em {new Date(ticket.created_at).toLocaleString("pt-BR")}
              {ticket.department_name && ` · Fila: ${ticket.department_name}`}
              {ticket.assigned_to_name
                ? ` · Analista: ${ticket.assigned_to_name}`
                : " · Aguardando um analista assumir"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
            <SlaCountdown slaDueAt={ticket.sla_due_at} closedAt={ticket.closed_at} />
          </div>
        </div>
      </div>

      <div className="card">
        <TicketConversation ticket={ticket} />
      </div>

      {ticket.status !== "encerrado" && (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            withBusy(() => api.post(`/tickets/${ticket.id}/comments`, { comment })).then(() => setComment(""));
          }}
        >
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Escreva uma mensagem para o analista..."
            className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <div className="flex justify-end">
            <button type="submit" disabled={busy || !comment.trim()} className="btn-primary text-sm">
              {busy ? "Enviando..." : "Enviar mensagem"}
            </button>
          </div>
        </form>
      )}

      {isOwner && ticket.status === "encerrado" && !rated && (
        <div className="card">
          <h2 className="mb-3 font-semibold">Como foi o atendimento?</h2>
          <div className="flex items-center gap-2">
            <select
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} estrela{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
            <button
              className="btn-primary text-sm"
              disabled={busy}
              onClick={() =>
                withBusy(() => api.post(`/tickets/${ticket.id}/rating`, { score: rating })).then(() =>
                  setRated(true),
                )
              }
            >
              Enviar avaliação
            </button>
          </div>
        </div>
      )}

      {rated && <p className="text-center text-sm text-emerald-700">Obrigado pela avaliação!</p>}
    </div>
  );
}
