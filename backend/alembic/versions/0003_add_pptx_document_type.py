"""add pptx to document_type enum

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-20 00:00:00

"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE não pode rodar dentro de uma transação no Postgres.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'pptx'")


def downgrade() -> None:
    # Postgres não suporta remover um valor de enum diretamente; seria necessário
    # recriar o tipo. Como 'pptx' não é referenciado pelo schema em nenhum outro
    # ponto, deixamos como no-op — reverter exigiria uma migração de dados dedicada
    # caso já existam `documents.file_type = 'pptx'` em produção.
    pass
