"""add status/closed_at to chat_conversations

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-24 00:00:00

"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    status = postgresql.ENUM("ativa", "encerrada", name="chat_conversation_status")
    status.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "chat_conversations",
        sa.Column(
            "status",
            postgresql.ENUM("ativa", "encerrada", name="chat_conversation_status", create_type=False),
            nullable=False,
            server_default="ativa",
        ),
    )
    op.add_column("chat_conversations", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_conversations", "closed_at")
    op.drop_column("chat_conversations", "status")
    op.execute("DROP TYPE IF EXISTS chat_conversation_status")
