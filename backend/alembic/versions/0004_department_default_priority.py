"""add default_priority to departments and set values per area

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-21 00:00:00

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

# Prioridade padrão por fila: chamados que afetam pagamento/saúde ficam mais
# altos na ordem de atendimento; solicitações de acesso/portal (ex.: ADP)
# ficam com prioridade baixa. Analistas ainda podem ajustar caso a caso.
DEPARTMENT_DEFAULT_PRIORITY = {
    "folha-de-pagamento": "critica",
    "ferias": "media",
    "vale-refeicao": "media",
    "plano-de-saude": "alta",
    "vale-transporte": "media",
    "banco-de-horas": "media",
    "admissao": "alta",
    "rescisao": "alta",
    "plano-odontologico": "media",
    "seguro-de-vida": "media",
    "totalpass": "baixa",
    "gympass": "baixa",
    "auxilio-creche": "media",
    "declaracoes": "baixa",
    "emprestimo-consignado": "media",
    "atualizacao-cadastral": "baixa",
    "telemedicina-conexa": "alta",
    "ponto": "baixa",
}


def upgrade() -> None:
    op.add_column(
        "departments",
        sa.Column(
            "default_priority",
            postgresql.ENUM("baixa", "media", "alta", "critica", name="ticket_priority", create_type=False),
            nullable=False,
            server_default="media",
        ),
    )

    conn = op.get_bind()
    for slug, priority in DEPARTMENT_DEFAULT_PRIORITY.items():
        conn.execute(
            sa.text("UPDATE departments SET default_priority = :priority WHERE slug = :slug"),
            {"priority": priority, "slug": slug},
        )


def downgrade() -> None:
    op.drop_column("departments", "default_priority")
