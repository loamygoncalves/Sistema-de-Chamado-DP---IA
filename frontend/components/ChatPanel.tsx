"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Conversation, Department, MessageResponse, TicketRef } from "@/lib/types";
import ConfidenceBadge from "@/components/ConfidenceBadge";

function formatSlaDeadline(slaDueAt: string | null): string {
  if (!slaDueAt) return "a definir";
  return new Date(slaDueAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  response?: MessageResponse;
  /** Resposta ao "isso resolveu sua dúvida?". `undefined` = ainda não respondeu. */
  wasHelpful?: boolean;
  /** Disse que não ajudou, mas recusou abrir chamado. */
  declinedTicket?: boolean;
}

export default function ChatPanel() {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startNewConversation();
    api.get<Department[]>("/departments").then(setDepartments).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function startNewConversation() {
    api.post<Conversation>("/chat/conversations", {}).then(setConversation).catch(() => {});
    setMessages([]);
  }

  async function endConversation() {
    if (!conversation || conversation.status === "encerrada") return;
    await api.post(`/chat/conversations/${conversation.id}/close`, {}).catch(() => {});
    // A IA "esquece" a conversa atual — a próxima pergunta começa uma conversa
    // nova, sem nenhuma memória desta.
    startNewConversation();
  }

  async function sendQuestion() {
    if (!input.trim() || !conversation || sending) return;
    const question = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setSending(true);
    try {
      const response = await api.post<MessageResponse>(`/chat/conversations/${conversation.id}/messages`, {
        content: question,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: response.answer, response }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Erro ao consultar a IA: ${(err as Error).message}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  /** Registra o "isso resolveu sua dúvida?" — perguntado após TODA resposta.
   *  O `false` é o que faz a próxima pergunta (abrir chamado?) aparecer. */
  async function rateAnswer(messageId: string, wasHelpful: boolean) {
    setMessages((prev) =>
      prev.map((m) => (m.response?.message_id === messageId ? { ...m, wasHelpful } : m)),
    );
    // O registro do feedback é o que dá o sinal de qualidade da base; se a
    // chamada falhar, a conversa não deve travar por isso.
    await api
      .post(`/chat/conversations/${conversation?.id}/messages/${messageId}/feedback`, {
        was_helpful: wasHelpful,
      })
      .catch(() => {});
  }

  function declineTicket(messageId: string) {
    setMessages((prev) =>
      prev.map((m) => (m.response?.message_id === messageId ? { ...m, declinedTicket: true } : m)),
    );
  }

  async function openSuggestedTicket(messageId: string) {
    if (!conversation || departments.length === 0) return;
    const departmentId = window.prompt(
      `Para qual fila deseja abrir o chamado?\n${departments.map((d, i) => `${i + 1}. ${d.name}`).join("\n")}`,
      "1"
    );
    const index = Number(departmentId) - 1;
    const department = departments[index];
    if (!department) return;
    const ticket = await api.post<TicketRef>(
      `/chat/conversations/${conversation.id}/messages/${messageId}/open-ticket?department_id=${department.id}`
    );
    setMessages((prev) =>
      prev.map((m) =>
        m.response?.message_id === messageId ? { ...m, response: { ...m.response!, ticket } } : m
      )
    );
  }

  return (
    <div className="card flex h-[560px] flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Pergunte à IA do BEEP</h2>
          <p className="text-sm text-slate-500">
            Ex.: &ldquo;Como funciona meu banco de horas?&rdquo;, &ldquo;Como solicitar férias?&rdquo;
          </p>
        </div>
        {messages.length > 0 && (
          <button className="btn-secondary shrink-0 text-xs" onClick={endConversation}>
            Encerrar conversa
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-slate-400">
            Faça sua primeira pergunta — a abertura de chamado é sempre a última alternativa.
          </p>
        )}
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "text-right" : "text-left"}>
            <div
              className={
                message.role === "user"
                  ? "inline-block max-w-[85%] rounded-2xl rounded-br-sm bg-brand-700 px-4 py-2 text-sm text-white"
                  : "inline-block max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-800"
              }
            >
              {message.content}
            </div>
            {message.response && (
              <div className="mt-1 space-y-1">
                <div>
                  <ConfidenceBadge decision={message.response.decision} score={message.response.confidence_score} />
                </div>
                {message.response.sources.length > 0 && (
                  <ul className="text-xs text-slate-500">
                    {message.response.sources.map((source) => (
                      <li key={source.id}>
                        Fonte: <span className="font-medium">{source.title}</span> ({source.type})
                      </li>
                    ))}
                  </ul>
                )}
                {/* Fluxo de duas etapas, igual para TODA resposta (inclusive
                    as de alta confiança): primeiro "resolveu?", e só quem diz
                    que não é que recebe a oferta de chamado. Isso mantém a
                    abertura de chamado como consequência do colaborador dizer
                    que não foi atendido, não do score de confiança da IA. */}
                {!message.response.ticket && message.wasHelpful === undefined && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">Isso resolveu sua dúvida?</span>
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => rateAnswer(message.response!.message_id, true)}
                    >
                      Sim, resolveu
                    </button>
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => rateAnswer(message.response!.message_id, false)}
                    >
                      Não, preciso de mais ajuda
                    </button>
                  </div>
                )}

                {message.wasHelpful === true && !message.response.ticket && (
                  <p className="text-xs text-emerald-700">
                    Que bom! Se precisar de mais alguma coisa, é só perguntar.
                  </p>
                )}

                {message.wasHelpful === false && !message.response.ticket && !message.declinedTicket && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-100 bg-accent-50 px-3 py-2">
                    <span className="text-xs text-accent-700">
                      Quer abrir um chamado para um analista do DP?
                    </span>
                    <button
                      className="btn-primary text-xs"
                      onClick={() => openSuggestedTicket(message.response!.message_id)}
                    >
                      Sim, abrir chamado
                    </button>
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => declineTicket(message.response!.message_id)}
                    >
                      Agora não
                    </button>
                  </div>
                )}

                {message.declinedTicket && !message.response.ticket && (
                  <p className="text-xs text-slate-500">
                    Tudo bem! Se mudar de ideia, me pergunte de novo e eu ofereço o chamado.
                  </p>
                )}

                {message.response.ticket && (
                  <p className="text-xs text-emerald-700">
                    Chamado <span className="font-semibold">{message.response.ticket.ticket_number}</span> aberto
                    para o DP. Aguarde a análise de um analista responsável — prazo de resposta:{" "}
                    <span className="font-semibold">{formatSlaDeadline(message.response.ticket.sla_due_at)}</span>.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          sendQuestion();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Digite sua dúvida..."
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button type="submit" disabled={sending} className="btn-primary">
          {sending ? "Enviando..." : "Enviar"}
        </button>
      </form>
    </div>
  );
}
