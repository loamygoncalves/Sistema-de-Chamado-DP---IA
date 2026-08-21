"""Notificação por e-mail de eventos do chamado: aberto, respondido
publicamente por um analista, e finalizado. Desativado por padrão
(`EMAIL_NOTIFICATIONS_ENABLED=false`) — sem SMTP configurado, o envio é
pulado silenciosamente em vez de falhar a operação que disparou o evento
(abrir/responder/encerrar chamado não pode quebrar por causa de e-mail).
"""

import smtplib
import uuid
from email.message import EmailMessage

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.ticket import Ticket
from app.models.user import User

TicketEvent = str  # "aberto" | "respondido" | "finalizado"

_SUBJECT_BY_EVENT = {
    "aberto": "Chamado {number} aberto — {subject}",
    "respondido": "Chamado {number} foi respondido",
    "finalizado": "Chamado {number} foi encerrado",
}

_BODY_BY_EVENT = {
    "aberto": (
        "Seu chamado {number} foi aberto com sucesso.\n\n"
        "Assunto: {subject}\n"
        "Prazo de resposta: {sla}\n\n"
        "Aguarde a análise de um analista responsável do Departamento Pessoal."
    ),
    "respondido": (
        "Seu chamado {number} recebeu uma resposta do Departamento Pessoal.\n\n"
        "Assunto: {subject}\n\n"
        "Acesse o sistema para ver a resposta completa e continuar o atendimento."
    ),
    "finalizado": (
        "Seu chamado {number} foi encerrado.\n\n"
        "Assunto: {subject}\n\n"
        "Se surgir alguma nova dúvida sobre esse assunto, é só abrir um novo chamado."
    ),
}


class EmailNotConfigured(Exception):
    pass


def _format_sla(ticket: Ticket) -> str:
    if not ticket.sla_due_at:
        return "a definir"
    return ticket.sla_due_at.strftime("%d/%m/%Y %H:%M")


def send_email(*, to: str, subject: str, body: str) -> None:
    if not settings.EMAIL_NOTIFICATIONS_ENABLED or not settings.SMTP_HOST:
        raise EmailNotConfigured("EMAIL_NOTIFICATIONS_ENABLED ou SMTP_HOST não configurados")

    message = EmailMessage()
    message["From"] = settings.SMTP_FROM_EMAIL
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        if settings.SMTP_USE_TLS:
            server.starttls()
        if settings.SMTP_USERNAME:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
        server.send_message(message)


async def notify_ticket_event(db: AsyncSession, ticket_id: str, event: TicketEvent) -> bool:
    """Retorna True se o e-mail foi enviado, False se foi pulado (não
    configurado, chamado/solicitante não encontrado, ou sem e-mail
    cadastrado) — nunca levanta exceção para não derrubar a task."""
    ticket = await db.get(Ticket, uuid.UUID(ticket_id))
    if ticket is None:
        return False
    requester = await db.get(User, ticket.requester_id)
    if requester is None or not requester.email:
        return False

    subject = _SUBJECT_BY_EVENT[event].format(number=ticket.ticket_number, subject=ticket.subject)
    body = _BODY_BY_EVENT[event].format(number=ticket.ticket_number, subject=ticket.subject, sla=_format_sla(ticket))

    try:
        send_email(to=requester.email, subject=subject, body=body)
        return True
    except EmailNotConfigured:
        return False
