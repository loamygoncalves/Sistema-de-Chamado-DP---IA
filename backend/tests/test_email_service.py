import uuid
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select

from app.models.department import Department
from app.models.ticket import Ticket
from app.models.user import User
from app.services import email_service
from app.services.email_service import EmailNotConfigured


def test_send_email_raises_when_notifications_disabled(monkeypatch):
    monkeypatch.setattr(email_service.settings, "EMAIL_NOTIFICATIONS_ENABLED", False)
    with pytest.raises(EmailNotConfigured):
        email_service.send_email(to="colaborador@beepsaude.com.br", subject="Assunto", body="Corpo")


def test_send_email_raises_when_smtp_host_missing(monkeypatch):
    monkeypatch.setattr(email_service.settings, "EMAIL_NOTIFICATIONS_ENABLED", True)
    monkeypatch.setattr(email_service.settings, "SMTP_HOST", None)
    with pytest.raises(EmailNotConfigured):
        email_service.send_email(to="colaborador@beepsaude.com.br", subject="Assunto", body="Corpo")


def test_send_email_uses_smtp_when_configured(monkeypatch):
    monkeypatch.setattr(email_service.settings, "EMAIL_NOTIFICATIONS_ENABLED", True)
    monkeypatch.setattr(email_service.settings, "SMTP_HOST", "smtp.beepsaude.com.br")
    monkeypatch.setattr(email_service.settings, "SMTP_PORT", 587)
    monkeypatch.setattr(email_service.settings, "SMTP_USERNAME", "dp@beepsaude.com.br")
    monkeypatch.setattr(email_service.settings, "SMTP_PASSWORD", "senha")
    monkeypatch.setattr(email_service.settings, "SMTP_USE_TLS", True)

    smtp_instance = MagicMock()
    smtp_instance.__enter__.return_value = smtp_instance
    with patch("app.services.email_service.smtplib.SMTP", return_value=smtp_instance) as smtp_cls:
        email_service.send_email(to="colaborador@beepsaude.com.br", subject="Assunto", body="Corpo")

    smtp_cls.assert_called_once_with("smtp.beepsaude.com.br", 587)
    smtp_instance.starttls.assert_called_once()
    smtp_instance.login.assert_called_once_with("dp@beepsaude.com.br", "senha")
    smtp_instance.send_message.assert_called_once()


@pytest.mark.asyncio
async def test_notify_ticket_event_skips_silently_when_not_configured(db_session, monkeypatch):
    monkeypatch.setattr(email_service.settings, "EMAIL_NOTIFICATIONS_ENABLED", False)
    department = (await db_session.execute(select(Department))).scalars().first()
    requester = User(
        name="Colaborador Notificação",
        email="notificacao@beepsaude.com.br",
        role="employee",
        identity_provider_sub=str(uuid.uuid4()),
    )
    db_session.add(requester)
    await db_session.flush()
    ticket = Ticket(
        ticket_number="BEEP-900001",
        requester_id=requester.id,
        department_id=department.id,
        subject="Assunto",
        description="Descrição",
    )
    db_session.add(ticket)
    await db_session.commit()

    sent = await email_service.notify_ticket_event(db_session, str(ticket.id), "aberto")
    assert sent is False


@pytest.mark.asyncio
async def test_notify_ticket_event_returns_false_for_requester_without_email(db_session, monkeypatch):
    monkeypatch.setattr(email_service.settings, "EMAIL_NOTIFICATIONS_ENABLED", True)
    monkeypatch.setattr(email_service.settings, "SMTP_HOST", "smtp.beepsaude.com.br")

    department = (await db_session.execute(select(Department))).scalars().first()
    requester = User(
        name="Sem Email",
        email="",
        role="employee",
        identity_provider_sub=str(uuid.uuid4()),
    )
    db_session.add(requester)
    await db_session.flush()
    ticket = Ticket(
        ticket_number="BEEP-900002",
        requester_id=requester.id,
        department_id=department.id,
        subject="Assunto",
        description="Descrição",
    )
    db_session.add(ticket)
    await db_session.commit()

    with patch("app.services.email_service.send_email") as send:
        sent = await email_service.notify_ticket_event(db_session, str(ticket.id), "aberto")
        assert sent is False
        send.assert_not_called()
