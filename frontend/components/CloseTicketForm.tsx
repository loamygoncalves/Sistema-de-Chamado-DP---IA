"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ClosureReasonOption } from "@/lib/types";

/** Encerramento com motivo obrigatório, usado tanto pelo analista quanto pelo
 *  colaborador. Os motivos disponíveis e as mensagens padrão vêm da API
 *  (`/tickets/closure-reasons`), que já devolve só o que o perfil de quem está
 *  logado pode usar — o colaborador não vê "falta de interatividade". */
export default function CloseTicketForm({
  ticketId,
  onClosed,
}: {
  ticketId: string;
  onClosed: () => void | Promise<void>;
}) {
  const [options, setOptions] = useState<ClosureReasonOption[]>([]);
  const [reason, setReason] = useState<string>("");
  const [message, setMessage] = useState("");
  const [messageEdited, setMessageEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ClosureReasonOption[]>("/tickets/closure-reasons")
      .then((opts) => {
        setOptions(opts);
        if (opts.length > 0) {
          setReason(opts[0].value);
          setMessage(opts[0].default_message);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  function pickReason(value: string) {
    setReason(value);
    // Só sobrescreve a mensagem se o usuário ainda não escreveu a dele —
    // trocar o motivo não pode apagar um texto que ele acabou de digitar.
    if (!messageEdited) {
      const option = options.find((o) => o.value === value);
      if (option) setMessage(option.default_message);
    }
  }

  async function submit() {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/tickets/${ticketId}/close`, { reason, message });
      await onClosed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (options.length === 0) {
    return <p className="text-xs text-slate-400">{error ?? "Carregando motivos de encerramento..."}</p>;
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-slate-500">
        Motivo do encerramento <span className="text-red-600">*</span>
        <select
          value={reason}
          disabled={busy}
          onChange={(e) => pickReason(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs text-slate-500">
        Mensagem que o colaborador vai receber
        <textarea
          value={message}
          disabled={busy}
          rows={4}
          onChange={(e) => {
            setMessage(e.target.value);
            setMessageEdited(true);
          }}
          className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button onClick={submit} disabled={busy || !reason} className="btn-primary w-full text-sm">
        {busy ? "Encerrando..." : "Encerrar chamado"}
      </button>
    </div>
  );
}
