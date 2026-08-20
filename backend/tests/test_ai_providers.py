import pytest

from app.services.ai_providers import AnthropicProvider, BedrockProvider, OpenAIProvider, get_llm_provider


def test_get_llm_provider_bedrock_requires_model_id(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "BEDROCK_MODEL_ID", None)
    with pytest.raises(ValueError, match="BEDROCK_MODEL_ID"):
        get_llm_provider("bedrock")


def test_get_llm_provider_bedrock_builds_client_from_iam_role(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-5-20250929-v1:0")
    monkeypatch.setattr(config.settings, "AWS_REGION", "us-east-1")
    provider = get_llm_provider("bedrock")
    assert isinstance(provider, BedrockProvider)
    assert isinstance(provider, AnthropicProvider)
    assert provider._model == "anthropic.claude-sonnet-4-5-20250929-v1:0"


def test_get_llm_provider_anthropic_and_openai():
    assert isinstance(get_llm_provider("anthropic"), AnthropicProvider)
    assert isinstance(get_llm_provider("openai"), OpenAIProvider)


def test_get_llm_provider_unknown_raises():
    with pytest.raises(ValueError, match="desconhecido"):
        get_llm_provider("watson")
