from datetime import date, datetime, timezone

from app.services.br_holidays import national_holidays
from app.services.business_time import add_business_hours, is_business_day


def test_national_holidays_include_fixed_and_movable_dates_2026():
    holidays = national_holidays(2026)
    assert date(2026, 1, 1) in holidays  # Confraternização Universal
    assert date(2026, 4, 21) in holidays  # Tiradentes
    assert date(2026, 12, 25) in holidays  # Natal
    # Páscoa 2026 cai em 5 de abril -> Sexta-feira Santa em 3 de abril.
    assert date(2026, 4, 3) in holidays


def test_is_business_day_excludes_weekends():
    saturday = date(2026, 8, 22)
    sunday = date(2026, 8, 23)
    monday = date(2026, 8, 24)
    assert saturday.weekday() == 5 and sunday.weekday() == 6
    assert not is_business_day(saturday, frozenset())
    assert not is_business_day(sunday, frozenset())
    assert is_business_day(monday, frozenset())


def test_add_business_hours_within_same_day():
    start = datetime(2026, 8, 24, 9, 0, tzinfo=timezone.utc)  # segunda-feira
    result = add_business_hours(start, 4)
    assert result == datetime(2026, 8, 24, 13, 0, tzinfo=timezone.utc)


def test_add_business_hours_skips_weekend():
    friday_afternoon = datetime(2026, 8, 21, 22, 0, tzinfo=timezone.utc)  # sexta-feira
    result = add_business_hours(friday_afternoon, 4)
    # As 2h restantes de sexta (22h-24h) contam; fim de semana é pulado;
    # as 2h finais caem na segunda-feira a partir da meia-noite.
    assert result == datetime(2026, 8, 24, 2, 0, tzinfo=timezone.utc)


def test_add_business_hours_skips_national_holiday():
    # 24/12/2026 é quinta-feira; 25/12 (Natal) é feriado e cai numa
    # sexta-feira colada ao fim de semana — o relógio do SLA só volta a
    # correr na segunda-feira (28/12).
    start = datetime(2026, 12, 24, 23, 0, tzinfo=timezone.utc)
    result = add_business_hours(start, 24)
    assert result == datetime(2026, 12, 28, 23, 0, tzinfo=timezone.utc)


def test_add_business_hours_zero_returns_same_instant():
    start = datetime(2026, 8, 24, 10, 0, tzinfo=timezone.utc)
    assert add_business_hours(start, 0) == start
