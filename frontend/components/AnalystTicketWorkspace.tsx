"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import type {
  Department,
  TicketDetail,
  TicketPriority,
  TicketStatus,
  User,
} from "@/lib/types";
import { PriorityBadge, StatusBadge } from "@/components/TicketStatusBadge";
import SlaCountdown from "@/components/SlaCountdown";
import TicketConversation from "@/components/TicketConversation";

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: "novo", label: "Novo" },
  { value: "em_triagem", label: "Em triagem" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "aguardando_usuario", label: "Aguardando colaborador" },
  { value: "resolvido", label: "Resolvido" },
  { value: "encerrado", label: "Encerrado" },
];

const PRIORITY_OPTIONS: { value: TicketPriority; label: string }[] = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica" },
];

const SOURCE_LABELS: Record<string, string> = {
  ia_automatico: "Aberto após a IA não ter resposta segura",
  ia_sugerido: "Aberto a partir de uma sugestão da IA",
  manual: "Aberto manualmente pelo colaborador",
};

type ReplyMode = "publica" | "interna";

export default function AnalystTicketWorkspace({ ticketId }: { ticketId: string }) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [analysts, setAnalysts] = useState<User[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ReplyMode>("publica");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    setTicket(await api.get<TicketDetail>(`/tickets/${ticketId}`));
  }, [ticketId]);

  useEffect(() => {
    reload().catch((e) => setError((e as Error).message));
    api.get<Department[]>("/departments").then(setDepartments).catch(() => {});
    api.get<User[]>("/users/analysts").then(setAnalysts).catch(() => {});
  }, [reload]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ticket?.history.length]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    const comment = draft.trim();
    if (!comment || busy) return;
    await run(async () => {
      await api.post(`/tickets/${ticketId}/comments`, { comment, is_internal: mode === "interna" });
      setDraft("");
    });
  }

  if (error && !ticket) return <p className="text-sm text-red-600">Erro ao carregar o chamado: {error}</p>;
  if (!ticket) return <p className="text-slate-500">Carregando chamado...</p>;

  const isClosed = ticket.status === "encerrado";
  const isInternal = mode === "interna";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ---------------- Conversa ---------------- */}
      <div className="space-y-4">
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs text-slate-500">{ticket.ticket_number}</p>
              <h1 className="text-lg font-semibold">{ticket.subject}</h1>
              <p className="mt-1 text-xs text-slate-500">
                {SOURCE_LABELS[ticket.source] ?? ticket.source} ·{" "}
                {new Date(ticket.created_at).toLocaleString("pt-BR")}
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
          <div ref={bottomRef} />
        </div>

        {/* ---------------- Resposta ----------------
            O modo muda a cor da caixa inteira de propósito: mandar uma nota
            interna achando que era resposta ao colaborador (ou o contrário) é
            o erro mais caro nesta tela, então os dois estados têm que ser
            visualmente inconfundíveis. */}
        <div
          className={clsx(
            "card border-2",
            isInternal ? "border-amber-300 bg-amber-50/60" : "border-brand-200",
          )}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMode("publica")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  !isInternal ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                )}
              >
                Responder ao colaborador
              </button>
              <button
                type="button"
                onClick={() => setMode("interna")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  isInternal ? "bg-white text-amber-900 shadow-sm" : "text-slate-500",
                )}
              >
                🔒 Nota interna
              </button>
            </div>
            <p className={clsx("text-xs", isInternal ? "text-amber-900" : "text-slate-500")}>
              {isInternal
                ? "Só o time de atendimento vê. O colaborador não recebe esta mensagem."
                : `${ticket.requester_name ?? "O colaborador"} vai ver esta mensagem no chamado.`}
            </p>
          </div>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply();
            }}
            rows={4}
            disabled={busy}
            placeholder={
              isInternal
                ? "Ex.: conferir com a folha se o desconto veio do consignado antes de responder."
                : "Escreva a resposta que o colaborador vai receber..."
            }
            className={clsx(
              "w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none",
              isInternal
                ? "border-amber-300 bg-white focus:border-amber-500"
                : "border-slate-300 focus:border-brand-500",
            )}
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">Ctrl/⌘ + Enter para enviar</span>
            <button
              onClick={sendReply}
              disabled={busy || !draft.trim()}
              className={clsx(
                "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50",
                isInternal ? "bg-amber-700 hover:bg-amber-800" : "bg-brand-700 hover:bg-brand-800",
              )}
            >
              {busy ? "Enviando..." : isInternal ? "Salvar nota interna" : "Enviar resposta"}
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- Painel lateral ---------------- */}
      <aside className="space-y-4">
        {error && (
          <div className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
        )}

        <div className="card space-y-3">
          <h2 className="text-sm font-semibold">Solicitante</h2>
          <div className="text-sm">
            <p className="font-medium">{ticket.requester_name ?? "—"}</p>
            <p className="text-xs text-slate-500">{ticket.requester_email ?? ""}</p>
            {ticket.matricula && <p className="text-xs text-slate-500">Matrícula {ticket.matricula}</p>}
          </div>
          <dl className="space-y-1 border-t border-slate-100 pt-3 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Fila</dt>
              <dd className="text-right font-medium">{ticket.department_name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Prazo (dias úteis)</dt>
              <dd className="text-right font-medium">
                {ticket.sla_due_at ? new Date(ticket.sla_due_at).toLocaleString("pt-BR") : "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="card space-y-3">
          <h2 className="text-sm font-semibold">Atendimento</h2>

          <label className="block text-xs text-slate-500">
            Analista responsável
            <select
              value={ticket.assigned_to ?? ""}
              disabled={busy}
              onChange={(e) =>
                e.target.value &&
                run(() => api.post(`/tickets/${ticketId}/transfer`, { assigned_to: e.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            >
              <option value="" disabled>
                Ninguém atribuído
              </option>
              {analysts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="btn-secondary w-full text-sm"
            disabled={busy}
            onClick={() => run(() => api.post(`/tickets/${ticketId}/assume`))}
          >
            Assumir para mim
          </button>

          <label className="block text-xs text-slate-500">
            Status
            <select
              value={ticket.status}
              disabled={busy}
              onChange={(e) =>
                run(() => api.patch(`/tickets/${ticketId}/status`, { status: e.target.value as TicketStatus }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-slate-500">
            Prioridade <span className="text-slate-400">(recalcula o prazo)</span>
            <select
              value={ticket.priority}
              disabled={busy}
              onChange={(e) =>
                run(() => api.patch(`/tickets/${ticketId}/priority`, { priority: e.target.value as TicketPriority }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-slate-500">
            Transferir de fila
            <select
              value=""
              disabled={busy}
              onChange={(e) =>
                e.target.value &&
                run(() => api.post(`/tickets/${ticketId}/transfer`, { department_id: e.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            >
              <option value="" disabled>
                Escolher outra fila...
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="btn-primary w-full text-sm"
            disabled={busy || isClosed}
            onClick={() => run(() => api.post(`/tickets/${ticketId}/close`, { status: "encerrado" }))}
          >
            {isClosed ? "Chamado encerrado" : "Encerrar chamado"}
          </button>
          <p className="text-xs text-slate-400">
            Ao encerrar, a IA gera um artigo de conhecimento a partir da resolução — dúvidas
            iguais passam a ser respondidas sem abrir chamado.
          </p>
        </div>
      </aside>
    </div>
  );
}
