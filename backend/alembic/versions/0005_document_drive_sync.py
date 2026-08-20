"""add google drive sync fields to documents

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-22 00:00:00

"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    source_provider = postgresql.ENUM("upload", "google_drive", name="document_source_provider")
    source_provider.create(op.get_bind(), checkfirst=True)

    op.alter_column("documents", "uploaded_by", existing_type=postgresql.UUID(as_uuid=True), nullable=True)

    op.add_column(
        "documents",
        sa.Column(
            "source_provider",
            postgresql.ENUM("upload", "google_drive", name="document_source_provider", create_type=False),
            nullable=False,
            server_default="upload",
        ),
    )
    op.add_column("documents", sa.Column("external_file_id", sa.String(255), nullable=True))
    op.add_column("documents", sa.Column("external_modified_time", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("uq_documents_external_file_id", "documents", ["external_file_id"])


def downgrade() -> None:
    op.drop_constraint("uq_documents_external_file_id", "documents", type_="unique")
    op.drop_column("documents", "external_modified_time")
    op.drop_column("documents", "external_file_id")
    op.drop_column("documents", "source_provider")
    op.alter_column("documents", "uploaded_by", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
    op.execute("DROP TYPE IF EXISTS document_source_provider")
