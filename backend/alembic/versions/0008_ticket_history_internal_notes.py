"""add is_internal to ticket_history (notas internas do analista)

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-26 00:00:00

"""
import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ticket_history",
        sa.Column("is_internal", sa.Boolean(), nullable=False, server_default="false"),
    )
    # O histórico que já existe é todo visível ao colaborador (era o único
    # comportamento possível antes desta coluna) — o server_default acima já
    # garante isso para as linhas existentes.


def downgrade() -> None:
    op.drop_column("ticket_history", "is_internal")
