"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Conversation, Department, MessageResponse } from "@/lib/types";
import ConfidenceBadge from "@/components/ConfidenceBadge";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  response?: MessageResponse;
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

  async function openSuggestedTicket(messageId: string) {
    if (!conversation || departments.length === 0) return;
    const departmentId = window.prompt(
      `Para qual fila deseja abrir o chamado?\n${departments.map((d, i) => `${i + 1}. ${d.name}`).join("\n")}`,
      "1"
    );
    const index = Number(departmentId) - 1;
    const department = departments[index];
    if (!department) return;
    const ticket = await api.post<{ id: string; ticket_number: string }>(
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
                  ? "inline-block max-w-[85%] rounded-2xl rounded-br-sm bg-brand-500 px-4 py-2 text-sm text-white"
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
                {(message.response.decision === "suggest_ticket" || message.response.decision === "auto_ticket") &&
                  !message.response.ticket && (
                    <button
                      className="btn-secondary mt-1 text-xs"
                      onClick={() => openSuggestedTicket(message.response!.message_id)}
                    >
                      {message.response.decision === "auto_ticket"
                        ? "Não resolveu? Abrir chamado para o DP"
                        : "Abrir chamado sobre esta dúvida"}
                    </button>
                  )}
                {message.response.ticket && (
                  <p className="text-xs text-emerald-700">
                    Chamado {message.response.ticket.ticket_number} aberto.
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
