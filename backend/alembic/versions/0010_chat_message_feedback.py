"""add was_helpful to chat_messages (feedback do colaborador)

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-28 00:00:00

"""
import sqlalchemy as sa

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable de propósito: nulo = colaborador ainda não respondeu se a
    # resposta ajudou. Não existe default — "não respondeu" é diferente de
    # "respondeu que não ajudou", e misturar os dois estragaria o indicador.
    op.add_column("chat_messages", sa.Column("was_helpful", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "was_helpful")
