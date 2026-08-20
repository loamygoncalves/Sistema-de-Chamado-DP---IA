"""Calendário de feriados nacionais brasileiros, usado para excluir SLA de
chamados durante fins de semana e feriados (fixos e móveis, calculados a
partir da Páscoa)."""

from datetime import date, timedelta
from functools import lru_cache


def _easter_sunday(year: int) -> date:
    """Algoritmo de Gauss/Anônimo para a data da Páscoa (calendário gregoriano)."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    ll = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ll) // 451
    month = (h + ll - 7 * m + 114) // 31
    day = ((h + ll - 7 * m + 114) % 31) + 1
    return date(year, month, day)


@lru_cache(maxsize=None)
def national_holidays(year: int) -> frozenset[date]:
    easter = _easter_sunday(year)
    movable = {
        easter - timedelta(days=47),  # Carnaval (terça-feira)
        easter - timedelta(days=2),  # Sexta-feira Santa
        easter + timedelta(days=60),  # Corpus Christi
    }
    fixed = {
        date(year, 1, 1),  # Confraternização Universal
        date(year, 4, 21),  # Tiradentes
        date(year, 5, 1),  # Dia do Trabalho
        date(year, 9, 7),  # Independência do Brasil
        date(year, 10, 12),  # Nossa Senhora Aparecida
        date(year, 11, 2),  # Finados
        date(year, 11, 15),  # Proclamação da República
        date(year, 11, 20),  # Dia Nacional de Zumbi e da Consciência Negra
        date(year, 12, 25),  # Natal
    }
    return frozenset(fixed | movable)


def holidays_for_range(start_year: int, end_year: int) -> frozenset[date]:
    result: set[date] = set()
    for year in range(start_year, end_year + 1):
        result |= national_holidays(year)
    return frozenset(result)
