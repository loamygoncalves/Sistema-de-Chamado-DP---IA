"""add closure_reason to tickets (motivo obrigatório de encerramento)

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-27 00:00:00

"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

REASONS = (
    "resolvido",
    "sem_interatividade",
    "duplicado",
    "resolvido_pelo_colaborador",
    "cancelado_pelo_colaborador",
)


def upgrade() -> None:
    reason = postgresql.ENUM(*REASONS, name="ticket_closure_reason")
    reason.create(op.get_bind(), checkfirst=True)

    # Nullable: fica nulo enquanto o chamado está aberto. Chamados já
    # encerrados antes desta coluna ficam sem motivo registrado (não há como
    # inferir retroativamente) — o relatório trata nulo como "não informado".
    op.add_column(
        "tickets",
        sa.Column(
            "closure_reason",
            postgresql.ENUM(*REASONS, name="ticket_closure_reason", create_type=False),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("tickets", "closure_reason")
    op.execute("DROP TYPE IF EXISTS ticket_closure_reason")
