/**
 * Cérebro do atendimento — decide O QUE responder e COMO responder,
 * usando só a base de conhecimento da empresa (aba FAQs). A parte
 * linguística (corretor de digitação, sinônimos, ranqueamento) mora em
 * TextMatch.gs.
 *
 * Roda 100% dentro do Google Workspace, sem custo e sem chamada externa:
 * nenhum dado de colaborador sai daqui e nenhuma informação vem da
 * internet — a IA só sabe o que está escrito na aba FAQs.
 *
 * O que faz não parecer um chatbot de FAQ:
 *  - a conversa tem memória (pergunta curta de acompanhamento herda o
 *    assunto anterior, ex.: "e se eu for plantonista?");
 *  - quando duas respostas estão empatadas, ela PERGUNTA em vez de
 *    chutar a errada;
 *  - a resposta reconhece o assunto entendido e sugere o próximo passo,
 *    em vez de despejar o texto cru do FAQ;
 *  - entende quem escreve errado, abrevia ou usa o nome popular das
 *    coisas (ver o dicionário de sinônimos em TextMatch.gs).
 */

// Quantas mensagens da conversa entram como contexto — o suficiente para
// entender um acompanhamento sem carregar a conversa inteira para sempre.
var CHAT_HISTORY_MAX_MESSAGES = 12;

// Pergunta com poucas palavras próprias (ex.: "e se for plantonista?") é
// acompanhamento: sozinha não diz o assunto, precisa herdar o anterior.
var FOLLOW_UP_MAX_TOKENS = 4;

// Se o 2º colocado chega perto do 1º, é ambiguidade de verdade — melhor
// perguntar do que arriscar a resposta errada.
var AMBIGUITY_RATIO = 0.82;

function getThresholds_() {
  var props = PropertiesService.getScriptProperties();
  return {
    auto: Number(props.getProperty('AUTO_THRESHOLD') || 0.45),
    suggest: Number(props.getProperty('SUGGEST_THRESHOLD') || 0.22)
  };
}

function normalizeHistory_(history) {
  if (!history || !history.length) return [];
  return history
    .filter(function (h) { return h && h.content && (h.role === 'user' || h.role === 'assistant'); })
    .slice(-CHAT_HISTORY_MAX_MESSAGES)
    .map(function (h) { return { role: h.role, content: String(h.content) }; });
}

/** Últimas perguntas do colaborador — é delas que um acompanhamento
 * herda o assunto (a resposta da IA não, senão o texto longo do FAQ
 * dominaria a busca e o assunto nunca mudaria). */
function previousUserQuestions_(history, limit) {
  return history
    .filter(function (h) { return h.role === 'user'; })
    .slice(-(limit || 2))
    .map(function (h) { return h.content; });
}

/** Escolhe uma variação de forma estável: a mesma pergunta gera sempre a
 * mesma resposta (previsível para o colaborador e para o suporte), mas
 * perguntas diferentes variam o texto — o que tira a cara de robô. */
function pickVariant_(options, seedText) {
  var seed = 0;
  var text = String(seedText || '');
  for (var i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) % 100000;
  return options[seed % options.length];
}

/** Monta a resposta com cara de conversa: reconhece o assunto, entrega o
 * conteúdo da base e abre o próximo passo. O conteúdo em si é sempre o
 * texto do FAQ — nada é inventado. */
function composeAnswer_(faq, opts) {
  opts = opts || {};
  var dept = faq.Departamento || 'Departamento Pessoal';
  var body = String(faq.Resposta).trim();
  var seed = opts.seed || faq.Pergunta;
  var parts = [];

  if (opts.isFollowUp) {
    parts.push(pickVariant_([
      'Complementando o que falamos sobre ' + dept + ':',
      'Ainda sobre ' + dept + ':',
      'Seguindo no mesmo assunto (' + dept + '):'
    ], seed));
  } else if (opts.confident) {
    parts.push(pickVariant_([
      'Sobre ' + dept + ' — aqui vai:',
      'Essa é sobre ' + dept + '. Olha só:',
      'Isso é tema de ' + dept + ':'
    ], seed));
  } else {
    // Confiança média: assume menos, deixa claro o que entendeu, para o
    // colaborador conseguir corrigir o rumo em vez de aceitar algo errado.
    parts.push(pickVariant_([
      'Pelo que entendi, sua dúvida é sobre ' + dept + '. Se for isso:',
      'Acho que você está perguntando sobre ' + dept + ':',
      'Entendi como um assunto de ' + dept + '. Veja se ajuda:'
    ], seed));
  }

  parts.push(body);

  if (!opts.confident) {
    parts.push('Se não era bem isso, me explica com outras palavras que eu procuro de novo.');
  }
  return parts.join('\n\n');
}

/**
 * Responde à pergunta do colaborador.
 *
 * `history` é a conversa até aqui (sem a pergunta atual). Ela serve para
 * dois fins: entender acompanhamento ("e no meu caso?") e não repetir o
 * que já foi dito. A CONFIANÇA, porém, é medida só contra a pergunta
 * atual — senão o contexto herdado inflaria o score e uma pergunta solta
 * feita depois de uma boa resposta pareceria bem respondida.
 *
 * Retorna {answer, decision, confidence, source, options}:
 *  - auto_answer   → a base respondeu bem
 *  - clarify       → empate real; `options` traz as opções para escolher
 *  - suggest_ticket→ respondeu, mas sem segurança total
 *  - auto_ticket   → a base não cobre o assunto
 */
function askAi(question, history) {
  var recentHistory = normalizeHistory_(history);
  var faqs = rowsAsObjects_(sheet_(SHEETS.FAQS, HEADERS.FAQs)).filter(function (f) {
    return f.Pergunta && f.Resposta;
  });

  if (faqs.length === 0) {
    return {
      answer: 'A base de conhecimento ainda está vazia, então não consigo responder com segurança. Posso abrir um chamado para um analista do DP te ajudar.',
      decision: 'auto_ticket', confidence: 0, source: null, options: []
    };
  }

  var index = buildIndex_(faqs);
  var analyzed = analyzeQuery_(question, index.vocabulary);

  // Acompanhamento: pergunta curta demais para dizer o assunto sozinha —
  // reaproveita as perguntas anteriores para não perder o fio.
  var isFollowUp = analyzed.tokens.length > 0 &&
    analyzed.tokens.length <= FOLLOW_UP_MAX_TOKENS &&
    recentHistory.length > 0;

  var searchTokens = analyzed.tokens;
  if (isFollowUp) {
    var previous = previousUserQuestions_(recentHistory, 2).join(' ');
    if (previous) {
      searchTokens = analyzed.tokens.concat(analyzeQuery_(previous, index.vocabulary).tokens);
    }
  }

  var ranked = rankDocuments_(searchTokens, index);
  if (ranked.length === 0) {
    return {
      answer: 'Não encontrei nada sobre isso na nossa base de conhecimento, então prefiro não arriscar uma resposta errada. Quer que eu abra um chamado para um analista do DP?',
      decision: 'auto_ticket', confidence: 0, source: null, options: []
    };
  }

  var best = ranked[0];
  // A confiança sai da cobertura medida contra a PERGUNTA ATUAL, não
  // contra o texto herdado do histórico.
  var ownRanking = isFollowUp ? rankDocuments_(analyzed.tokens, index) : ranked;
  var ownBest = null;
  for (var i = 0; i < ownRanking.length; i++) {
    if (ownRanking[i].faq === best.faq) { ownBest = ownRanking[i]; break; }
  }
  // Confiança combina duas perguntas diferentes e igualmente necessárias:
  // "achei o que ele perguntou?" (coverage) e "este FAQ é mesmo sobre
  // isso?" (focus). Só a primeira não basta: um FAQ que menciona as
  // palavras de passagem teria coverage alta e responderia com segurança
  // algo que não é do assunto.
  var reference = ownBest || best;
  var rawConfidence = reference.coverage * (0.5 + 0.5 * reference.focus);
  var confidence = (isFollowUp && !ownBest) ? rawConfidence * 0.85 : rawConfidence;

  var thresholds = getThresholds_();

  // Freio para a frase longa em que quase nada foi reconhecido: em "qual o
  // horário do ônibus 372?" o sistema entende apenas "ônibus" e responderia
  // sobre vale-transporte com toda a certeza. Aqui ele ainda mostra o que
  // achou, mas com ressalva e oferecendo o chamado. O freio não vale para
  // perguntas curtas ("holerite errado"), em que uma palavra reconhecida
  // já é a pergunta inteira.
  if (analyzed.words.length >= 3 && analyzed.recognition < 0.5) {
    confidence = Math.min(confidence, thresholds.auto - 0.01);
  }

  if (confidence < thresholds.suggest) {
    return {
      answer: 'Entendi mais ou menos o que você precisa, mas não achei na base algo que responda com segurança — e prefiro não chutar. Quer que eu abra um chamado para um analista do DP olhar seu caso?',
      decision: 'auto_ticket', confidence: confidence,
      source: { department: best.faq.Departamento, question: best.faq.Pergunta }, options: []
    };
  }

  // Empate real entre dois assuntos: perguntar é melhor que adivinhar.
  var runnerUp = ranked[1];
  if (runnerUp && best.score > 0 && (runnerUp.score / best.score) >= AMBIGUITY_RATIO &&
      runnerUp.faq.Departamento !== best.faq.Departamento) {
    return {
      answer: 'Sua pergunta pode ser sobre dois assuntos diferentes e não quero te dar a resposta errada. Qual deles é o seu caso?',
      decision: 'clarify', confidence: confidence,
      source: { department: best.faq.Departamento, question: best.faq.Pergunta },
      options: [
        { label: best.faq.Departamento + ' — ' + best.faq.Pergunta, question: best.faq.Pergunta },
        { label: runnerUp.faq.Departamento + ' — ' + runnerUp.faq.Pergunta, question: runnerUp.faq.Pergunta }
      ]
    };
  }

  var confident = confidence >= thresholds.auto;
  return {
    answer: composeAnswer_(best.faq, { confident: confident, isFollowUp: isFollowUp, seed: question }),
    decision: confident ? 'auto_answer' : 'suggest_ticket',
    confidence: confidence,
    source: { department: best.faq.Departamento, question: best.faq.Pergunta },
    options: []
  };
}

/**
 * Resumo do caso para o analista, montado a partir da conversa real —
 * sem transcrever tudo. Escrito por regra (não por LLM): identifica o
 * assunto, lista o que o colaborador perguntou e aponta o que a base já
 * cobriu, para o analista saber de onde partir.
 */
function draftTicketContext(question, sourceFaqQuestion, history) {
  var recentHistory = normalizeHistory_(history);
  var perguntas = previousUserQuestions_(recentHistory, 5);
  var parts = [];

  parts.push('Resumo automático da conversa com a IA (a IA não conseguiu resolver o caso).');
  parts.push('Dúvida principal do colaborador:\n"' + String(question).trim() + '"');

  if (perguntas.length > 0) {
    var anteriores = perguntas.filter(function (p) { return p.trim() !== String(question).trim(); });
    if (anteriores.length > 0) {
      parts.push('Outras perguntas feitas na mesma conversa:\n' +
        anteriores.map(function (p) { return '• ' + p.trim(); }).join('\n'));
    }
  }

  if (sourceFaqQuestion) {
    parts.push('A IA identificou o assunto como relacionado a "' + sourceFaqQuestion + '" e apresentou a ' +
      'orientação padrão desse tema, mas o colaborador indicou que isso não resolveu o caso dele — ' +
      'provavelmente há uma particularidade (valor, data, situação específica) que a resposta genérica não cobre.');
  } else {
    parts.push('A base de conhecimento não cobre esse assunto — pode ser um caso novo, ainda não documentado ' +
      'nas políticas e FAQs. Vale avaliar se cabe virar um novo item da base depois de resolvido.');
  }

  parts.push('Sugestão: confirmar com o colaborador os dados específicos do caso antes de concluir a análise.');
  return parts.join('\n\n');
}
