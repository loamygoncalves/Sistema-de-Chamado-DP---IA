/**
 * "IA" deste protótipo, em duas camadas:
 *
 * 1) Casador léxico de FAQs (sempre ativo, sem custo, sem chave de API) —
 *    decide SE existe uma resposta segura na base de conhecimento e com que
 *    confiança, igual ao motor de decisão do sistema real (ver
 *    ai_settings / RAG_CONFIDENCE_THRESHOLDS no backend).
 * 2) Chamada à API da Anthropic (opcional — só roda se ANTHROPIC_API_KEY
 *    estiver definida em Script Properties) para responder de forma
 *    natural e para sintetizar o contexto do chamado para o analista, do
 *    mesmo jeito que o backend real usa um LLM sobre o resultado do RAG.
 *    Sem a chave, cai para o texto literal do FAQ / um resumo simples —
 *    nunca quebra o fluxo.
 *
 * A conversa é multi-turno de verdade: o cliente manda o histórico completo
 * a cada pergunta, e ele vai junto na chamada à Claude — não é só uma pista
 * de busca, é contexto real de conversa (mesmo papel do CHAT_HISTORY do
 * backend). Sem isso, cada pergunta seria respondida isolada, como um
 * chatbot de FAQ raso, sem lembrar do que já foi dito.
 */

var STOPWORDS_ = [
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'é', 'um', 'uma', 'uns', 'umas', 'para', 'com', 'no',
  'na', 'em', 'nos', 'nas', 'que', 'como', 'qual', 'quais', 'meu', 'minha', 'meus', 'minhas', 'me', 'eu', 'ao', 'aos', 'à', 'às',
  'por', 'se', 'tem', 'tenho', 'sobre', 'sua', 'seu', 'suas', 'seus', 'ou'
];

// Quantas mensagens (colaborador + IA) da conversa entram no contexto da
// IA — limite para o prompt não crescer sem fim numa conversa longa.
var CHAT_HISTORY_MAX_MESSAGES = 12;

function normalize_(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ');
}

function tokenize_(s) {
  return normalize_(s).split(/\s+/).filter(function (w) { return w.length > 2 && STOPWORDS_.indexOf(w) === -1; });
}

function overlap_(tokensA, tokensB) {
  var n = 0;
  tokensA.forEach(function (x) { if (tokensB.indexOf(x) !== -1) n++; });
  return n;
}

function rawScore_(faq, tokens) {
  var qTok = tokenize_(faq.Pergunta);
  var aTok = tokenize_(faq.Resposta);
  return (2 * overlap_(tokens, qTok) + overlap_(tokens, aTok)) / (tokens.length + qTok.length + 1);
}

function scoreToConfidence_(raw) {
  return Math.max(0, Math.min(0.97, Math.pow(raw * 1.55, 0.72)));
}

function retrieveFaqs_(searchText, topN) {
  var tokens = tokenize_(searchText);
  var faqs = rowsAsObjects_(sheet_(SHEETS.FAQS, HEADERS.FAQs));
  if (tokens.length === 0 || faqs.length === 0) return [];
  var scored = faqs.map(function (f) { return { faq: f, raw: rawScore_(f, tokens) }; });
  scored.sort(function (a, b) { return b.raw - a.raw; });
  return scored.slice(0, topN || 3);
}

function getThresholds_() {
  var props = PropertiesService.getScriptProperties();
  return {
    auto: Number(props.getProperty('AUTO_THRESHOLD') || 0.85),
    suggest: Number(props.getProperty('SUGGEST_THRESHOLD') || 0.60)
  };
}

/** Recorta e normaliza o histórico recebido do cliente: só os últimos
 * CHAT_HISTORY_MAX_MESSAGES turnos, só {role, content} válidos. */
function normalizeHistory_(history) {
  if (!history || !history.length) return [];
  return history
    .filter(function (h) { return h && h.content && (h.role === 'user' || h.role === 'assistant'); })
    .slice(-CHAT_HISTORY_MAX_MESSAGES)
    .map(function (h) { return { role: h.role, content: String(h.content) }; });
}

/** `history` é a conversa inteira até aqui (sem incluir `question`) — usada
 * para ACHAR a fonte certa num acompanhamento ("e isso muda se eu...") e
 * para a Claude manter o fio da conversa de verdade. A CONFIANÇA, porém, é
 * medida só contra a pergunta atual — senão o histórico carregado infla o
 * score e uma pergunta solta, feita logo depois de uma boa resposta,
 * pareceria "resposta automática". */
function askAi(question, history) {
  var recentHistory = normalizeHistory_(history);
  var recentText = recentHistory.map(function (h) { return h.content; }).join(' ');
  var searchText = recentText ? (recentText + ' ' + question) : question;
  var candidates = retrieveFaqs_(searchText, 3);
  var best = candidates[0];
  var confidence = best ? scoreToConfidence_(rawScore_(best.faq, tokenize_(question))) : 0;

  if (!best || confidence < 0.12) {
    return {
      answer: 'Não encontrei informação suficiente na base de conhecimento para responder com segurança.',
      decision: 'auto_ticket', confidence: 0, source: null
    };
  }

  var thresholds = getThresholds_();
  var decision = 'auto_ticket';
  if (confidence > thresholds.auto) decision = 'auto_answer';
  else if (confidence >= thresholds.suggest) decision = 'suggest_ticket';

  var answerText = best.faq.Resposta;
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (apiKey) {
    try {
      answerText = rephraseWithClaude_(apiKey, question, candidates.map(function (c) { return c.faq; }), recentHistory);
    } catch (e) {
      Logger.log('Falha ao chamar a IA, usando resposta literal do FAQ: ' + e);
    }
  }
  return {
    answer: answerText, decision: decision, confidence: confidence,
    source: { department: best.faq.Departamento, question: best.faq.Pergunta }
  };
}

/** `claude-opus-5` é o modelo padrão recomendado para uso com a API da
 * Anthropic. Sem parâmetro `thinking` explícito, o Opus 5 já roda com
 * pensamento adaptativo por padrão — por isso a resposta pode trazer um
 * bloco `thinking` antes do bloco de texto; nunca presuma que o texto está
 * em `content[0]`, sempre filtre por `type === 'text'`.
 * `messages` já é o array completo no formato da API ([{role, content}, ...]),
 * terminando no turno atual do usuário — quem monta isso é o chamador. */
function callClaude_(apiKey, systemPrompt, messages, maxTokens) {
  var payload = {
    model: 'claude-opus-5',
    max_tokens: maxTokens || 500,
    messages: messages
  };
  if (systemPrompt) payload.system = systemPrompt;
  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var json = JSON.parse(response.getContentText());
  if (json.error) throw new Error('Erro da API da Anthropic: ' + (json.error.message || JSON.stringify(json.error)));
  var textBlock = (json.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (textBlock) return textBlock.text.trim();
  throw new Error('Resposta inesperada da API da Anthropic: ' + response.getContentText());
}

/** Responde SÓ com base nos FAQs recuperados — nunca inventa dado que não
 * esteja no contexto (mesma regra do prompt do backend real). `history`
 * (já normalizado) entra como turnos de verdade antes da pergunta atual,
 * para a conversa fluir — um "e isso muda se eu for autônomo?" só faz
 * sentido pra Claude se ela viu a pergunta anterior. */
function rephraseWithClaude_(apiKey, question, faqs, history) {
  var context = faqs.map(function (f, i) { return (i + 1) + '. P: ' + f.Pergunta + '\nR: ' + f.Resposta; }).join('\n\n');
  var systemPrompt =
    'Você é a assistente de RH da Beep Saúde, conversando com um colaborador. Responda usando SOMENTE as ' +
    'informações do contexto abaixo (o contexto pode mudar a cada pergunta, conforme o assunto da conversa). ' +
    'Não invente nenhum dado (valores, prazos, regras) que não esteja no contexto. Considere o histórico da ' +
    'conversa para entender perguntas de acompanhamento (ex.: "e se eu for autônomo?"). Seja direta e ' +
    'acolhedora, em português do Brasil, em até 4 frases.\n\nContexto para esta pergunta:\n' + context;
  var messages = (history || []).map(function (h) { return { role: h.role, content: h.content }; });
  messages.push({ role: 'user', content: question });
  return callClaude_(apiKey, systemPrompt, messages, 400);
}

function summarizeHistoryForDraft_(history) {
  if (!history || !history.length) return '';
  var lines = history.map(function (h) {
    return (h.role === 'user' ? 'Colaborador: ' : 'IA: ') + h.content;
  });
  return 'Conversa até aqui:\n' + lines.join('\n');
}

function buildFallbackDraft_(question, sourceFaqQuestion, history) {
  var parts = ['Colaborador relata a seguinte dúvida: "' + question + '"'];
  if (sourceFaqQuestion) {
    parts.push(
      'A IA reconheceu o assunto como relacionado a "' + sourceFaqQuestion + '", mas o colaborador confirmou ' +
      'que a resposta não resolveu o caso dele — indício de alguma particularidade não coberta pela resposta genérica.'
    );
  } else {
    parts.push('A IA não encontrou uma resposta segura na base de conhecimento para esse assunto.');
  }
  var historySummary = summarizeHistoryForDraft_(history);
  if (historySummary) parts.push(historySummary);
  parts.push('Recomenda-se avaliar o caso individualmente antes de responder.');
  return parts.join('\n\n');
}

/** Sintetiza o contexto do chamado para o analista — o mesmo papel que
 * `draft_ticket_context` cumpre no backend real. `history` é a conversa
 * inteira até a pergunta que motivou a abertura do chamado. Sem chave de
 * API, cai para um resumo estruturado simples (nunca transcreve a
 * conversa crua). */
function draftTicketContext(question, sourceFaqQuestion, history) {
  var recentHistory = normalizeHistory_(history);
  var fallback = buildFallbackDraft_(question, sourceFaqQuestion, recentHistory);
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return fallback;
  try {
    var transcript = recentHistory.map(function (h) {
      return (h.role === 'user' ? 'Colaborador: ' : 'IA: ') + h.content;
    }).join('\n');
    var prompt =
      (transcript ? 'Conversa até aqui:\n' + transcript + '\n\n' : '') +
      'Pergunta que motivou a abertura do chamado: "' + question + '"\n' +
      (sourceFaqQuestion
        ? 'A IA reconheceu o assunto como relacionado a "' + sourceFaqQuestion + '", mas isso não resolveu o caso.\n'
        : 'A IA não encontrou uma resposta segura para essa pergunta.\n') +
      'O colaborador confirmou que quer abrir um chamado.\n\n' +
      'Escreva, em português do Brasil, um resumo de 2 a 3 parágrafos para o analista de RH entender o caso ' +
      'rapidamente. Não transcreva a conversa literalmente — sintetize, dê contexto e destaque o que precisa ' +
      'de atenção. Não inclua saudação nem assinatura, só o resumo.';
    return callClaude_(apiKey, null, [{ role: 'user', content: prompt }], 700);
  } catch (e) {
    Logger.log('Falha ao gerar resumo com IA, usando resumo padrão: ' + e);
    return fallback;
  }
}
