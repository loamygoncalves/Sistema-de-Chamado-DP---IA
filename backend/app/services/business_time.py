"""Aritmética de prazos que desconsidera fins de semana e feriados nacionais.

Usado para calcular o vencimento de SLA dos chamados: as horas de prazo só
correm em dias úteis — sábado, domingo e feriado não contam.
"""

from datetime import date, datetime, timedelta

from app.services.br_holidays import holidays_for_range

ONE_HOUR = timedelta(hours=1)


def is_business_day(day: date, holidays: frozenset[date]) -> bool:
    return day.weekday() < 5 and day not in holidays


def add_business_hours(start: datetime, hours: float) -> datetime:
    """Soma `hours` a `start`, pulando integralmente sábados, domingos e
    feriados nacionais — o relógio do SLA não corre nesses dias."""
    holidays = holidays_for_range(start.year, start.year + 1)
    remaining = hours
    current = start

    while remaining > 0:
        if is_business_day(current.date(), holidays):
            step = min(remaining, 1.0)
            current += timedelta(hours=step)
            remaining -= step
        else:
            next_day = (current + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            current = next_day

    return current
