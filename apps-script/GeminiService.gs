/**
 * Reescrita da resposta via IA generativa (Gemini, Google AI Studio) —
 * camada OPCIONAL por cima do motor local (TextMatch.gs / AiService.gs).
 *
 * Por que é opcional: o motor local já garante uma resposta correta (o
 * texto sempre vem do FAQ, nunca é inventado) e funciona 100% de graça,
 * sem chamada externa. O Gemini entra só para REESCREVER esse mesmo
 * conteúdo de um jeito mais natural. Se a chamada falhar por qualquer
 * motivo — sem chave configurada, cota do plano gratuito estourada, rede
 * fora do ar, resposta vazia ou estranha — a resposta determinística que
 * o motor local já calculou continua valendo. O colaborador nunca vê um
 * erro por causa disto; na pior das hipóteses, a resposta só não fica tão
 * "polida" quanto poderia.
 *
 * Configuração (Extensões > Apps Script > Configurações do projeto >
 * Propriedades do script):
 *   GEMINI_API_KEY        — chave grátis da Google AI Studio
 *                            (aistudio.google.com/apikey). Sem isso, a
 *                            reescrita fica desligada e nada muda.
 *   GEMINI_MODEL           — opcional. Padrão: 'gemini-flash-lite-latest'
 *                            (alias que a própria Google atualiza sozinha
 *                            pro modelo mais novo da linha Flash-Lite —
 *                            a mais generosa no plano gratuito).
 *   GEMINI_REWRITE_ENABLED — opcional. 'false' desliga mesmo com chave
 *                            configurada (pausa rápida sem apagar a chave).
 *
 * O plano gratuito tem limite baixo de chamadas por minuto/dia — por
 * isso o resultado fica em cache (CacheService, até 6h) por par
 * pergunta+FAQ: perguntas repetidas por colaboradores diferentes
 * ("quando cai o pagamento?") não gastam uma chamada nova cada vez.
 */

var GEMINI_ENDPOINT_BASE_ = 'https://generativelanguage.googleapis.com/v1beta/models/';
var GEMINI_CACHE_TTL_SECONDS_ = 6 * 60 * 60; // 6h — o máximo do CacheService

function geminiConfig_() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('GEMINI_API_KEY') || '';
  var enabledFlag = props.getProperty('GEMINI_REWRITE_ENABLED');
  return {
    apiKey: apiKey,
    model: props.getProperty('GEMINI_MODEL') || 'gemini-flash-lite-latest',
    enabled: !!apiKey && enabledFlag !== 'false'
  };
}

var GEMINI_SYSTEM_PROMPT_ =
  'Você é a assistente de RH (Departamento Pessoal) da empresa Beep, respondendo dúvidas de colaboradores em um chat. Regras obrigatórias:\n' +
  '1. Baseie a resposta EXCLUSIVAMENTE no texto-base fornecido. Nunca invente, deduza ou complete números, prazos, valores ou regras que não estejam explicitamente nele.\n' +
  '2. Se a pergunta pedir um detalhe que não está no texto-base, diga isso claramente (ex.: "a nossa base não detalha esse ponto específico") — não tente adivinhar ou generalizar.\n' +
  '3. Escreva em português do Brasil, tom natural e acolhedor, como alguém do RH conversando — não como quem está lendo um manual ou colando um texto pronto.\n' +
  '4. Vá direto à resposta, sem saudação nem despedida — é uma mensagem dentro de uma conversa em andamento.\n' +
  '5. Não use markdown, títulos, listas numeradas ou bullets — escreva em texto corrido, como uma mensagem de chat.\n' +
  '6. Responda só com o texto final da resposta ao colaborador, nada de comentário sobre esta instrução.';

/**
 * Monta o prompt com o texto-base do FAQ (a única fonte de verdade) e
 * chama o Gemini para reescrever. Devolve o texto reescrito, ou null se
 * qualquer coisa falhar — quem chama sempre tem a resposta determinística
 * como fallback (ver askAi() em AiService.gs).
 *
 * `opts` (todos opcionais): { confident, highlight, isFollowUp, previousQuestion, debug }.
 * `opts.debug`, se for um objeto, recebe `opts.debug.info` com o motivo de
 * sucesso/falha — usado só para diagnóstico (ver GEMINI_DEBUG no
 * askAi()), não muda em nada o comportamento normal.
 */
function rewriteAnswerWithGemini_(question, faq, opts) {
  opts = opts || {};
  var debug = opts.debug || null;
  var config = geminiConfig_();
  if (!config.enabled) {
    if (debug) debug.info = 'desligado (sem GEMINI_API_KEY ou GEMINI_REWRITE_ENABLED=false)';
    return null;
  }

  var cacheKey = geminiCacheKey_(question, faq, opts);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) {
    if (debug) debug.info = 'cache hit (modelo ' + config.model + ')';
    return cached;
  }

  var userPrompt = 'Departamento: ' + (faq.Departamento || 'Departamento Pessoal') + '\n' +
    'Texto-base (única fonte de verdade — não use nada fora disso):\n"""\n' + faq.Resposta + '\n"""\n';

  if (opts.highlight) {
    userPrompt += '\nTrecho mais relevante para esta pergunta específica: "' + opts.highlight + '"\n';
  }
  if (opts.isFollowUp && opts.previousQuestion) {
    userPrompt += '\nIsto é uma CONTINUAÇÃO da conversa — a pergunta anterior do colaborador foi: "' +
      opts.previousQuestion + '", e você já respondeu sobre este mesmo assunto. Responda de forma natural, ' +
      'sem reapresentar o assunto do zero.\n';
  }
  if (!opts.confident) {
    userPrompt += '\nVocê não tem certeza total de que este é o assunto certo. Ao final da resposta, convide ' +
      'com naturalidade o colaborador a reformular a pergunta caso não seja bem isso.\n';
  }
  userPrompt += '\nPergunta atual do colaborador: "' + question + '"';

  var payload = {
    systemInstruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT_ }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 400 }
  };

  try {
    var response = UrlFetchApp.fetch(GEMINI_ENDPOINT_BASE_ + config.model + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': config.apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      // Cota do plano gratuito estourada, chave inválida, modelo errado etc.
      var errorBody = response.getContentText().slice(0, 300);
      Logger.log('Gemini rewrite falhou (HTTP ' + response.getResponseCode() + '): ' + errorBody);
      if (debug) debug.info = 'HTTP ' + response.getResponseCode() + ' — ' + errorBody;
      return null;
    }

    var data = JSON.parse(response.getContentText());
    var text = data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    if (!text || String(text).trim().length < 10) {
      if (debug) debug.info = 'resposta vazia ou curta demais: ' + JSON.stringify(data).slice(0, 300);
      return null;
    }

    text = String(text).trim();
    cache.put(cacheKey, text, GEMINI_CACHE_TTL_SECONDS_);
    Logger.log('Gemini rewrite OK (modelo ' + config.model + ', assunto "' + faq.Departamento + '")');
    if (debug) debug.info = 'sucesso (modelo ' + config.model + ')';
    return text;
  } catch (e) {
    Logger.log('Gemini rewrite deu erro: ' + e);
    if (debug) debug.info = 'exceção: ' + e;
    return null;
  }
}

/** Chave de cache inclui tudo que muda o PROMPT (não só a pergunta): o
 * FAQ, o trecho em destaque e a pergunta anterior (quando é
 * acompanhamento) — senão duas conversas diferentes com a mesma pergunta
 * literal, mas contextos diferentes, poderiam reaproveitar por engano a
 * resposta cacheada uma da outra. */
function geminiCacheKey_(question, faq, opts) {
  var raw = normalize_(question) + '|' + faq.Pergunta + '|' + (opts.highlight || '') +
    '|' + (opts.previousQuestion || '') + '|' + (opts.confident ? '1' : '0');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return 'gemini_' + Utilities.base64EncodeWebSafe(digest);
}
