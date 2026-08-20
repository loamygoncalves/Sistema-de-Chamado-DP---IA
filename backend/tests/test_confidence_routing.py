from app.models.enums import ChatDecision
from app.services.chat_service import _decide


def test_high_confidence_auto_answers():
    assert _decide(0.95, threshold_auto=0.85, threshold_suggest=0.60) == ChatDecision.AUTO_ANSWER


def test_boundary_confidence_suggests_ticket():
    assert _decide(0.85, threshold_auto=0.85, threshold_suggest=0.60) == ChatDecision.SUGGEST_TICKET
    assert _decide(0.60, threshold_auto=0.85, threshold_suggest=0.60) == ChatDecision.SUGGEST_TICKET
    assert _decide(0.72, threshold_auto=0.85, threshold_suggest=0.60) == ChatDecision.SUGGEST_TICKET


def test_low_confidence_opens_ticket_automatically():
    assert _decide(0.10, threshold_auto=0.85, threshold_suggest=0.60) == ChatDecision.AUTO_TICKET


def test_thresholds_are_parametrizable():
    assert _decide(0.50, threshold_auto=0.40, threshold_suggest=0.20) == ChatDecision.AUTO_ANSWER
