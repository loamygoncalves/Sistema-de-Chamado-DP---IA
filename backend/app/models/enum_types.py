from sqlalchemy import Enum


def pg_enum(enum_cls, name: str) -> Enum:
    """SQLAlchemy's Enum() stores the Python member's `.name` by default (e.g. "EMPLOYEE"),
    but our Postgres enum types and API contract use the lowercase `.value` (e.g. "employee").
    Every enum column must go through this helper instead of raw `Enum(...)`."""
    return Enum(enum_cls, name=name, values_callable=lambda cls: [member.value for member in cls])
