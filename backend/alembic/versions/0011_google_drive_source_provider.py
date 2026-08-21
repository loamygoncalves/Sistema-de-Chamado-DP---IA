"""add back google_drive as a document source provider (coexists with local_folder)

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-21 00:00:00

"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Postgres não permite ALTER TYPE ... ADD VALUE dentro da mesma transação
    # em que o valor é usado, mas rodar sozinho funciona a partir do PG 12.
    # 'local_folder' continua existindo — os dois provedores coexistem, cada
    # documento aponta pra um dos dois conforme de onde foi sincronizado.
    op.execute("ALTER TYPE document_source_provider ADD VALUE IF NOT EXISTS 'google_drive'")


def downgrade() -> None:
    # Postgres não suporta remover um valor de enum (DROP VALUE) — 'google_drive'
    # fica registrado no tipo mesmo após o downgrade; isso não afeta dados
    # já gravados, só permite (inofensivamente) o valor continuar válido.
    pass
