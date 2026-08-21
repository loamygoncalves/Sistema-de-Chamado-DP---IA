"""Provedores de LLM configuráveis (Claude direto, OpenAI, ou Claude via Amazon
Bedrock) por trás de uma interface comum.

Trocar de provedor é uma questão de configuração (`DEFAULT_LLM_PROVIDER` ou o valor
salvo em `ai_settings`), sem alterar o restante do pipeline de RAG.
"""

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass

from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings

SYSTEM_PROMPT = """Você é o assistente de atendimento interno da BEEP Saúde.
Responda SOMENTE com base no CONTEXTO fornecido, que vem da base de conhecimento
corporativa (políticas, FAQs, procedimentos, convenções coletivas, artigos e
chamados encerrados). Se o contexto não permitir responder com segurança, diga
isso explicitamente.

Raciocine como um analista experiente de Departamento Pessoal, não como uma
tabela de respostas prontas. Muitos temas de DP (pagamento, benefícios, ponto)
dependem de dados específicos do caso (datas, competência, cargo, histórico) que
a pergunta sozinha não traz — nesses casos, não afirme uma conclusão absoluta.
Em vez disso: identifique o assunto, explique em poucas palavras o que
normalmente precisa ser conferido para esse tipo de caso (a mesma verificação
que um analista faria) e peça ao colaborador as informações que faltam para
concluir a análise. Só afirme algo com certeza quando o CONTEXTO já contiver o
dado específico necessário (política, prazo, regra) para a pergunta feita.

Responda em JSON estrito com as chaves:
- "answer": resposta objetiva e completa em português.
- "confidence": número entre 0 e 1 representando o quanto o CONTEXTO sustenta a
  resposta (1 = totalmente sustentada por uma fonte clara e específica; 0 = sem
  relação com o contexto).
- "used_source_ids": lista dos ids de fonte (do CONTEXTO) efetivamente utilizados.
"""


@dataclass
class LLMResult:
    answer: str
    confidence: float
    used_source_ids: list[str]


class LLMProvider(ABC):
    @abstractmethod
    async def generate(
        self, *, question: str, context_blocks: list[dict], history: list[dict] | None = None
    ) -> LLMResult: ...

    @abstractmethod
    async def summarize_ticket(self, *, subject: str, description: str, resolution_history: str) -> dict: ...


def _build_context_prompt(question: str, context_blocks: list[dict]) -> str:
    context_text = "\n\n".join(
        f"[Fonte id={block['id']} tipo={block['type']} titulo=\"{block['title']}\"]\n{block['text']}"
        for block in context_blocks
    )
    return f"CONTEXTO:\n{context_text}\n\nPERGUNTA DO COLABORADOR:\n{question}"


def _parse_json_response(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end != -1:
            return json.loads(raw[start : end + 1])
        raise


class AnthropicProvider(LLMProvider):
    def __init__(self) -> None:
        import anthropic

        self._client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self._model = settings.ANTHROPIC_MODEL

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
    async def generate(
        self, *, question: str, context_blocks: list[dict], history: list[dict] | None = None
    ) -> LLMResult:
        messages = [{"role": turn["role"], "content": turn["content"]} for turn in (history or [])]
        messages.append({"role": "user", "content": _build_context_prompt(question, context_blocks)})
        message = await self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        data = _parse_json_response(message.content[0].text)
        return LLMResult(
            answer=data["answer"], confidence=float(data["confidence"]), used_source_ids=data.get("used_source_ids", [])
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
    async def summarize_ticket(self, *, subject: str, description: str, resolution_history: str) -> dict:
        prompt = (
            "Resuma o chamado abaixo e produza um artigo de base de conhecimento reutilizável.\n"
            f"Assunto: {subject}\nDescrição: {description}\nHistórico de resolução: {resolution_history}\n\n"
            'Responda em JSON: {"summary": "...", "root_cause": "...", "solution": "...", '
            '"article_title": "...", "article_content": "...", "tags": ["..."]}'
        )
        message = await self._client.messages.create(
            model=self._model, max_tokens=1024, messages=[{"role": "user", "content": prompt}]
        )
        return _parse_json_response(message.content[0].text)


class BedrockProvider(AnthropicProvider):
    """Claude via Amazon Bedrock — mesma interface do SDK da Anthropic
    (`.messages.create()`), só troca a autenticação: em vez de uma
    ANTHROPIC_API_KEY, usa a role IAM da task/instância (credenciais
    resolvidas automaticamente pelo boto3). Requer solicitar acesso ao
    modelo desejado no console do Bedrock antes do primeiro uso."""

    def __init__(self) -> None:
        import anthropic

        if not settings.BEDROCK_MODEL_ID:
            raise ValueError("BEDROCK_MODEL_ID não configurado — confirme o id do modelo no console do Bedrock")
        self._client = anthropic.AsyncAnthropicBedrock(aws_region=settings.AWS_REGION)
        self._model = settings.BEDROCK_MODEL_ID


class OpenAIProvider(LLMProvider):
    def __init__(self) -> None:
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self._model = settings.OPENAI_MODEL

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
    async def generate(
        self, *, question: str, context_blocks: list[dict], history: list[dict] | None = None
    ) -> LLMResult:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend({"role": turn["role"], "content": turn["content"]} for turn in (history or []))
        messages.append({"role": "user", "content": _build_context_prompt(question, context_blocks)})
        completion = await self._client.chat.completions.create(
            model=self._model,
            response_format={"type": "json_object"},
            messages=messages,
        )
        data = _parse_json_response(completion.choices[0].message.content)
        return LLMResult(
            answer=data["answer"], confidence=float(data["confidence"]), used_source_ids=data.get("used_source_ids", [])
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
    async def summarize_ticket(self, *, subject: str, description: str, resolution_history: str) -> dict:
        prompt = (
            "Resuma o chamado abaixo e produza um artigo de base de conhecimento reutilizável.\n"
            f"Assunto: {subject}\nDescrição: {description}\nHistórico de resolução: {resolution_history}\n\n"
            'Responda em JSON: {"summary": "...", "root_cause": "...", "solution": "...", '
            '"article_title": "...", "article_content": "...", "tags": ["..."]}'
        )
        completion = await self._client.chat.completions.create(
            model=self._model,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        return _parse_json_response(completion.choices[0].message.content)


def get_llm_provider(provider_name: str | None = None) -> LLMProvider:
    name = provider_name or settings.DEFAULT_LLM_PROVIDER
    if name == "anthropic":
        return AnthropicProvider()
    if name == "openai":
        return OpenAIProvider()
    if name == "bedrock":
        return BedrockProvider()
    raise ValueError(f"Provedor de IA desconhecido: {name}")
