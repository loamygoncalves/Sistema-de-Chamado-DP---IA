"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Department, TicketDetail, TicketPriority, TicketStatus } from "@/lib/types";
import { StatusBadge, PriorityBadge } from "@/components/TicketStatusBadge";

const STATUS_OPTIONS: TicketStatus[] = [
  "novo",
  "em_triagem",
  "em_atendimento",
  "aguardando_usuario",
  "resolvido",
  "encerrado",
];

export default function TicketDetailView({ ticketId, isAnalystView = false }: { ticketId: string; isAnalystView?: boolean }) {
  const { user } = useAuth();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState(5);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const data = await api.get<TicketDetail>(`/tickets/${ticketId}`);
    setTicket(data);
  }, [ticketId]);

  useEffect(() => {
    reload();
    api.get<Department[]>("/departments").then(setDepartments);
  }, [reload]);

  if (!ticket || !user) return <p className="text-slate-500">Carregando chamado...</p>;

  const isOwner = ticket.requester_id === user.id;
  const isStaff = ["analyst", "department_lead", "admin"].includes(user.role);

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
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">
              {ticket.ticket_number} · {ticket.subject}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Aberto em {new Date(ticket.created_at).toLocaleString("pt-BR")} · Origem: {ticket.source}
            </p>
          </div>
          <div className="flex gap-2">
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
          </div>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{ticket.description}</p>
      </div>

      {isAnalystView && isStaff && (
        <div className="card">
          <h2 className="mb-3 font-semibold">Ações do analista</h2>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={busy} onClick={() => withBusy(() => api.post(`/tickets/${ticket.id}/assume`))}>
              Assumir chamado
            </button>
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => e.target.value && withBusy(() => api.post(`/tickets/${ticket.id}/transfer`, { department_id: e.target.value }))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Transferir para...
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select
              value={ticket.priority}
              disabled={busy}
              onChange={(e) => withBusy(() => api.patch(`/tickets/${ticket.id}/priority`, { priority: e.target.value as TicketPriority }))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {(["baixa", "media", "alta", "critica"] as TicketPriority[]).map((p) => (
                <option key={p} value={p}>
                  Prioridade: {p}
                </option>
              ))}
            </select>
            <select
              value={ticket.status}
              disabled={busy}
              onChange={(e) => withBusy(() => api.patch(`/tickets/${ticket.id}/status`, { status: e.target.value as TicketStatus }))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  Status: {s}
                </option>
              ))}
            </select>
            <button
              className="btn-primary"
              disabled={busy || ticket.status === "encerrado"}
              onClick={() => withBusy(() => api.post(`/tickets/${ticket.id}/close`, {}))}
            >
              Encerrar chamado
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 font-semibold">Histórico</h2>
        <ul className="space-y-2">
          {ticket.history.map((entry) => (
            <li key={entry.id} className="border-l-2 border-brand-100 pl-3 text-sm">
              <span className="font-medium">{entry.action}</span>
              {entry.comment && <span className="text-slate-600"> — {entry.comment}</span>}
              <div className="text-xs text-slate-400">{new Date(entry.created_at).toLocaleString("pt-BR")}</div>
            </li>
          ))}
        </ul>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            withBusy(() => api.post(`/tickets/${ticket.id}/comments`, { comment })).then(() => setComment(""));
          }}
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Adicionar comentário..."
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy} className="btn-secondary">
            Comentar
          </button>
        </form>
      </div>

      {isOwner && ticket.status === "encerrado" && (
        <div className="card">
          <h2 className="mb-3 font-semibold">Avaliar atendimento</h2>
          <div className="flex items-center gap-2">
            <select value={rating} onChange={(e) => setRating(Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} estrela{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
            <button className="btn-primary" disabled={busy} onClick={() => withBusy(() => api.post(`/tickets/${ticket.id}/rating`, { score: rating }))}>
              Enviar avaliação
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
