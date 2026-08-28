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

/**
 * Confiança de um resultado, combinando três perguntas:
 *  - "achei o que ele perguntou?"     → coverage
 *  - "este FAQ é mesmo sobre isso?"   → focus
 *  - "entendi a frase que ele digitou?" → recognition
 *
 * A terceira é o freio contra a frase longa em que só uma palavra foi
 * reconhecida: em "qual o horário do ônibus 372?" o sistema entende
 * apenas "ônibus" e, sem esse freio, responderia sobre vale-transporte
 * com toda a certeza do mundo. Não vale para perguntas curtas, em que
 * uma palavra reconhecida já é a pergunta inteira.
 */
function confidenceOf_(result, analyzed, thresholds) {
  var value = result.coverage * (0.5 + 0.5 * result.focus);
  if (analyzed.words.length >= 3 && analyzed.recognition < 0.5) {
    value = Math.min(value, thresholds.auto - 0.01);
  }
  return value;
}

/**
 * Nem toda mensagem é uma pergunta. "Era exatamente essa resposta que eu
 * queria", "obrigado", "bom dia", "não era isso" — tratar tudo como
 * consulta à base faz a IA responder um FAQ aleatório para um "obrigado",
 * que é o comportamento mais robótico que existe.
 *
 * Devolve: 'gratidao' | 'saudacao' | 'despedida' | 'correcao' | 'pergunta'.
 */
var NEGACAO_ = [
  /\bnao (e|era|eh) (isso|essa|esse)\b/, /\bnao (estou|to|tou) (falando|perguntando|querendo)\b/,
  /\bnao entendi\b/, /\bnao (ajudou|resolveu|serviu|era bem isso)\b/, /\bnao foi isso\b/,
  /\bnada a ver\b/, /\bta errado\b/, /\bnao quis dizer\b/
];

var GRATIDAO_ = [
  /\bobrigad/, /\bvaleu\b/, /\bagradec/, /\bperfeito\b/, /\botimo\b/, /\bexcelente\b/,
  /\bera (exatamente |bem |justamente )?(isso|essa|esse)\b/, /\bessa (e|era) a resposta\b/,
  /\bque eu queria\b/, /\b(me )?(ajudou|resolveu|esclareceu)\b/, /\bconsegui\b/,
  /\bshow\b/, /\bbeleza\b/, /\bmuito bom\b/, /\bera isso mesmo\b/, /\bentendi\b/
];

var SAUDACAO_ = /^\s*(oi|ola|opa|eai|e ai|bom dia|boa tarde|boa noite|hey|hi)\b/;
var DESPEDIDA_ = /\b(tchau|ate mais|ate logo|falou|flw|xau|ate a proxima)\b/;

function detectIntent_(question, history) {
  var t = ' ' + normalize_(question) + ' ';
  var palavras = normalize_(question).trim().split(/\s+/).length;

  // Negação vem antes de gratidão de propósito: "não entendi" e "não
  // ajudou" contêm as mesmas palavras dos elogios, com sentido oposto.
  for (var i = 0; i < NEGACAO_.length; i++) {
    if (NEGACAO_[i].test(t)) return 'correcao';
  }
  if (history.length > 0) {
    for (var j = 0; j < GRATIDAO_.length; j++) {
      // Frase longa com "obrigado" no meio costuma ser agradecimento +
      // nova pergunta ("obrigado! e sobre férias?") — essa continua sendo
      // tratada como pergunta, para não engolir a dúvida junto.
      if (GRATIDAO_[j].test(t) && palavras <= 10 && question.indexOf('?') === -1) return 'gratidao';
    }
  }
  if (SAUDACAO_.test(t) && palavras <= 4) return 'saudacao';
  if (DESPEDIDA_.test(t) && palavras <= 6) return 'despedida';
  return 'pergunta';
}

/** Resposta de conversa (não consulta a base, não oferece chamado, não
 * mostra confiança) — é só a IA se comportando como gente. */
function smallTalkAnswer_(intent, seed) {
  if (intent === 'gratidao') {
    return pickVariant_([
      'Que bom que ajudou! 😊 Fico à disposição — se surgir qualquer outra dúvida de DP, é só me chamar.',
      'Fico feliz em ter ajudado! Se precisar de mais alguma coisa sobre DP, estou por aqui.',
      'Perfeito, era isso mesmo então! Qualquer outra dúvida, é só perguntar.'
    ], seed);
  }
  if (intent === 'saudacao') {
    return pickVariant_([
      'Oi! Sou a assistente do DP da Beep. Pode perguntar sobre folha de pagamento, férias, benefícios, ponto, documentos — o que você precisar.',
      'Olá! Posso te ajudar com dúvidas de DP: pagamento, férias, benefícios, ponto, atestados e por aí vai. O que você precisa?'
    ], seed);
  }
  return pickVariant_([
    'Até mais! Qualquer dúvida de DP, é só voltar aqui. 👋',
    'Precisando, estou por aqui. Até logo!'
  ], seed);
}

/**
 * A pergunta aponta para algo já dito? "Como eu consigo ESSE e-mail?",
 * "e ISSO muda se...", "como faço NESSE caso?" — o pronome demonstrativo
 * é a marca de que a frase não se explica sozinha.
 *
 * Sem esse sinal, "como consigo esse e-mail?" casa com os FAQs de
 * TotalPass/Gympass (que também falam em "e-mail") e a conversa pula para
 * um assunto que o colaborador não perguntou. Com ele, a frase é lida
 * como continuação — e, se a base já tiver dito o que tinha, cai no
 * caminho honesto de oferecer o analista.
 */
function isReferential_(question) {
  var text = ' ' + normalize_(question) + ' ';
  return /\s(esse|essa|isso|esses|essas|desse|dessa|nesse|nessa|disso|dele|dela|deles|delas)\s/.test(text) ||
    /^\s*e\s/.test(text);
}

/** Este FAQ já foi entregue nesta conversa? Compara o começo do texto da
 * resposta com o que a IA já disse — se a pessoa insiste no assunto, é
 * porque a base não tem o detalhe que ela quer, e repetir não ajuda. */
function alreadyAnswered_(faq, history) {
  var body = String(faq.Resposta).trim();
  if (body.length < 40) return false;
  var fingerprint = body.substring(0, 60);
  for (var i = 0; i < history.length; i++) {
    if (history[i].role === 'assistant' && history[i].content.indexOf(fingerprint) !== -1) return true;
  }
  return false;
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

  if (opts.isCorrection) {
    // Reconhece o engano antes de tentar de novo — sem isso, insistir num
    // novo FAQ depois de um "não é isso" soa como se a IA não tivesse lido.
    parts.push(pickVariant_([
      'Ah, desculpa — entendi errado. Deixa eu tentar de novo:',
      'Foi mal, me confundi. Veja se é isto:',
      'Entendi, não era isso mesmo. Talvez seja isto:'
    ], seed));
  } else if (opts.isFollowUp) {
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

  // Antes de qualquer busca: isto é mesmo uma pergunta? Um "obrigado, era
  // isso!" não deve virar consulta à base de conhecimento.
  var intent = detectIntent_(question, recentHistory);
  if (intent === 'gratidao' || intent === 'saudacao' || intent === 'despedida') {
    return {
      answer: smallTalkAnswer_(intent, question),
      decision: 'conversa', confidence: 1, source: null, options: []
    };
  }

  var index = buildIndex_(faqs);
  var analyzed = analyzeQuery_(question, index.vocabulary);
  var thresholds = getThresholds_();
  var isCorrection = intent === 'correcao';

  // A pergunta SOZINHA vem primeiro. O histórico só entra se ela não se
  // sustentar por conta própria — senão uma troca clara de assunto ("qual
  // dia cai o salário?" depois de uma conversa sobre ponto) fica presa no
  // assunto anterior, que é exatamente o que acontecia antes desta ordem.
  var ranked = rankDocuments_(analyzed.tokens, index);
  var confidence = ranked.length ? confidenceOf_(ranked[0], analyzed, thresholds) : 0;
  var isFollowUp = false;

  var needsContext = confidence < thresholds.suggest || isReferential_(question);
  if (needsContext && recentHistory.length > 0) {
    // Aí sim: pergunta que não diz o assunto sozinha ("e no meu caso?",
    // "como consigo isso?") herda o contexto das perguntas anteriores.
    var previous = previousUserQuestions_(recentHistory, 2).join(' ');
    if (previous) {
      var merged = analyzed.tokens.concat(analyzeQuery_(previous, index.vocabulary).tokens);
      var withHistory = rankDocuments_(merged, index);
      if (withHistory.length) {
        ranked = withHistory;
        isFollowUp = true;
        // Confiança de acompanhamento é sempre mais baixa: quem respondeu
        // foi o contexto, não a frase que a pessoa escreveu.
        confidence = confidenceOf_(withHistory[0], analyzed, thresholds) * 0.85 + 0.25;
      }
    }
  }

  if (ranked.length === 0) {
    return {
      answer: 'Não encontrei nada sobre isso na nossa base de conhecimento, então prefiro não arriscar uma resposta errada. Quer que eu abra um chamado para um analista do DP?',
      decision: 'auto_ticket', confidence: 0, source: null, options: []
    };
  }

  // "Não é isso que eu perguntei": o colaborador está corrigindo o rumo,
  // então o que já foi respondido sai da disputa e a IA tenta a próxima
  // melhor opção, em vez de insistir no mesmo FAQ.
  if (isCorrection) {
    var remaining = ranked.filter(function (r) { return !alreadyAnswered_(r.faq, recentHistory); });
    if (remaining.length > 0) {
      ranked = remaining;
      confidence = confidenceOf_(ranked[0], analyzed, thresholds);
    }
  }

  var best = ranked[0];

  // Se este FAQ já foi entregue nesta conversa, repeti-lo palavra por
  // palavra não responde nada — foi o que aconteceu quando o colaborador
  // perguntou "como consigo esse e-mail?" e recebeu o mesmo texto de novo.
  // A base já deu o que tinha sobre o assunto: o honesto é dizer isso e
  // oferecer o analista.
  if (alreadyAnswered_(best.faq, recentHistory)) {
    return {
      answer: 'Sobre ' + (best.faq.Departamento || 'esse assunto') + ' eu já te passei tudo o que a nossa base tem — ' +
        'ela não detalha esse ponto específico que você está perguntando agora. Para não te dar uma resposta ' +
        'incompleta, o melhor caminho é um analista do DP olhar o seu caso. Quer que eu abra o chamado?',
      decision: 'auto_ticket', confidence: confidence,
      source: { department: best.faq.Departamento, question: best.faq.Pergunta }, options: []
    };
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
    answer: composeAnswer_(best.faq, { confident: confident, isFollowUp: isFollowUp, isCorrection: isCorrection, seed: question }),
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
