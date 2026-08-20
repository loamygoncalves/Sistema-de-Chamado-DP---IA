"""seed departments and default ai settings

Revision ID: 0002
Revises: 0001
Create Date: 2026-01-01 00:05:00

"""
import json

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

DEPARTMENTS = [
    ("Folha de pagamento", "folha-de-pagamento", 24),
    ("Férias", "ferias", 48),
    ("Vale Refeição", "vale-refeicao", 24),
    ("Plano de saúde", "plano-de-saude", 24),
    ("Vale transporte", "vale-transporte", 24),
    ("Banco de horas", "banco-de-horas", 24),
    ("Admissão", "admissao", 48),
    ("Rescisão", "rescisao", 72),
    ("Plano Odontológico", "plano-odontologico", 24),
    ("Seguro de Vida", "seguro-de-vida", 48),
    ("TotalPass", "totalpass", 24),
    ("Gympass", "gympass", 24),
    ("Auxílio Creche", "auxilio-creche", 48),
    ("Declarações", "declaracoes", 24),
    ("Empréstimo Consignado", "emprestimo-consignado", 48),
    ("Atualização Cadastral", "atualizacao-cadastral", 24),
    ("Telemedicina Conexa", "telemedicina-conexa", 12),
    ("Ponto", "ponto", 24),
]

AI_SETTINGS = [
    ("confidence_threshold_auto", {"value": 0.85}, "Score acima do qual a IA responde automaticamente."),
    ("confidence_threshold_suggest", {"value": 0.60}, "Score mínimo para sugerir abertura de chamado."),
    ("default_llm_provider", {"value": "anthropic"}, "Provedor de LLM padrão."),
    ("default_llm_model", {"value": "claude-sonnet-5"}, "Modelo padrão do provedor."),
    ("rag_top_k", {"value": 6}, "Quantidade de trechos recuperados por consulta RAG."),
    (
        "sla_by_priority",
        {"baixa": 72, "media": 48, "alta": 24, "critica": 4},
        "SLA em horas por prioridade (aplicado sobre o SLA padrão da fila).",
    ),
]


def upgrade() -> None:
    conn = op.get_bind()
    for name, slug, sla in DEPARTMENTS:
        conn.execute(
            sa.text(
                "INSERT INTO departments (id, name, slug, default_sla_hours) "
                "VALUES (gen_random_uuid(), :name, :slug, :sla) "
                "ON CONFLICT (slug) DO NOTHING"
            ),
            {"name": name, "slug": slug, "sla": sla},
        )

    for key, value, description in AI_SETTINGS:
        conn.execute(
            sa.text(
                "INSERT INTO ai_settings (id, key, value, description) "
                "VALUES (gen_random_uuid(), :key, CAST(:value AS JSONB), :description) "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {"key": key, "value": json.dumps(value), "description": description},
        )


def downgrade() -> None:
    conn = op.get_bind()
    for _, slug, _ in DEPARTMENTS:
        conn.execute(sa.text("DELETE FROM departments WHERE slug = :slug"), {"slug": slug})
    for key, _, _ in AI_SETTINGS:
        conn.execute(sa.text("DELETE FROM ai_settings WHERE key = :key"), {"key": key})
