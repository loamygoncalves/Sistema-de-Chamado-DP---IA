"""replace google drive sync with local folder sync

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-25 00:00:00

"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Postgres não permite ALTER TYPE ... ADD VALUE dentro da mesma transação
    # em que o valor é usado, mas rodar sozinho (sem usá-lo logo em seguida)
    # funciona normalmente a partir do Postgres 12.
    op.execute("ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'txt'")
    op.execute("ALTER TYPE document_source_provider RENAME VALUE 'google_drive' TO 'local_folder'")


def downgrade() -> None:
    # Postgres não suporta remover um valor de enum (DROP VALUE) — 'txt' fica
    # registrado no tipo mesmo após o downgrade; isso não afeta dados
    # existentes, só permite (inofensivamente) o valor continuar válido.
    op.execute("ALTER TYPE document_source_provider RENAME VALUE 'local_folder' TO 'google_drive'")
