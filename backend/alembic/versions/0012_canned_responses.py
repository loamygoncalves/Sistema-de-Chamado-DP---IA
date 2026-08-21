"""add canned_responses table (respostas padrão do analista)

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-22 00:00:00

"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "canned_responses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(150), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("department_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("departments.id"), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_canned_responses_department_id", "canned_responses", ["department_id"])


def downgrade() -> None:
    op.drop_index("ix_canned_responses_department_id", table_name="canned_responses")
    op.drop_table("canned_responses")
