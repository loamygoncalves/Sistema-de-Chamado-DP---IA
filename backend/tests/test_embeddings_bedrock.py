import io
import json
from unittest.mock import MagicMock, patch

import pytest

from app.services.embeddings import EmbeddingService

pytestmark = pytest.mark.asyncio


async def test_embed_one_bedrock_calls_titan_via_boto3(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "EMBEDDING_PROVIDER", "bedrock")
    monkeypatch.setattr(config.settings, "BEDROCK_EMBEDDING_MODEL_ID", "amazon.titan-embed-text-v2:0")
    monkeypatch.setattr(config.settings, "AWS_REGION", "us-east-1")

    fake_body = io.BytesIO(json.dumps({"embedding": [0.1, 0.2, 0.3]}).encode())
    fake_bedrock_client = MagicMock()
    fake_bedrock_client.invoke_model.return_value = {"body": fake_body}

    with patch("boto3.client", return_value=fake_bedrock_client) as boto_client:
        service = EmbeddingService()
        vector = await service.embed_one("Como funciona o vale refeição?")

    assert vector == [0.1, 0.2, 0.3]
    boto_client.assert_called_once_with("bedrock-runtime", region_name="us-east-1")
    called_kwargs = fake_bedrock_client.invoke_model.call_args.kwargs
    assert called_kwargs["modelId"] == "amazon.titan-embed-text-v2:0"
    assert json.loads(called_kwargs["body"]) == {"inputText": "Como funciona o vale refeição?"}
