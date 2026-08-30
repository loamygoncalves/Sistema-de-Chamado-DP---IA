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
 * Devolve: 'gratidao' | 'saudacao' | 'cortesia' | 'despedida' | 'correcao' |
 * 'pergunta'.
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

// Cortesia social ("tudo bem?", "como vai?"). Parece pergunta e tem ponto
// de interrogação, mas não é consulta à base — e as palavras dela existem
// nos FAQs ("em dias de folga, TUDO vira crédito de banco de horas"), então
// sem esta regra um "tudo bem?" era respondido com o FAQ de banco de horas.
var CORTESIA_ = /^\s*(e ai\s+)?(tudo (bem|bom|certo|tranquilo|joia)|td (bem|bom)|como (vai|voce esta|vc esta|esta|ta)|beleza|blz|tranquilo)\b/;

// A regra acima só reconhece a palavra certa — "tudo bm?" (erro de
// digitação em "bem") não bate em nada ali, cai na busca de FAQ e ainda
// corre o risco de casar errado (foi exatamente o que aconteceu: bateu no
// FAQ de banco de horas, que também tem a palavra "tudo" no meio do
// texto). Esta segunda checagem tolera erro de digitação, mas só na
// abertura de cortesia ("tudo"/"td"/"como") + uma palavra pareça com um
// dos alvos — não é a mesma tolerância usada pra combinar FAQ (essa exige
// palavra longa; aqui "bem"/"bom" são curtas de propósito).
var CORTESIA_ABERTURA_ = /^\s*(e ai\s+)?(tudo|td|como|beleza|blz)\b/;
var CORTESIA_ALVOS_ = ['bem', 'bom', 'certo', 'tranquilo', 'joia', 'beleza', 'blz', 'tranquila', 'vai', 'esta'];

function pareceCortesiaComErro_(question) {
  var normalizado = normalize_(question);
  if (!CORTESIA_ABERTURA_.test(normalizado)) return false;
  var palavras = normalizado.trim().split(/\s+/);
  if (palavras.length > 5) return false;
  return palavras.some(function (p) {
    return CORTESIA_ALVOS_.some(function (alvo) { return p !== alvo && levenshtein_(p, alvo, 1) <= 1; });
  });
}

// A cortesia acima é só o lado de quem PERGUNTA ("tudo bem?"). Falta o
// lado de quem RESPONDE — "estou bem", "to bem, obrigado" — que a IA
// também provoca (ela mesma pergunta "em que posso te ajudar?"). Sem
// isto, "estou bem" (curta, sem assunto próprio) virava "acompanhamento"
// e herdava o assunto anterior da conversa, respondendo (errado) como se
// fosse sobre o FAQ de antes — foi exatamente o que aconteceu.
var CORTESIA_RESPOSTA_ = /^\s*(eu )?(estou|to|tou|tava|ando|ta)?\s*(tudo )?(bem|bom|tranquilo|numa boa|joia)\s*(mesmo|sim|obrigad[oa])?\s*$/;

function pareceRespostaCortesia_(question) {
  var normalizado = normalize_(question).trim();
  var palavras = normalizado.split(/\s+/);
  if (palavras.length > 4) return false;
  if (CORTESIA_RESPOSTA_.test(normalizado)) return true;
  // Mesmo com erro de digitação em "bem"/"bom" (ex.: "to bm"), pelo mesmo
  // motivo da checagem de pergunta acima.
  return palavras.some(function (p) {
    return ['bem', 'bom', 'tranquilo', 'joia'].some(function (alvo) { return p !== alvo && p.length > 1 && levenshtein_(p, alvo, 1) <= 1; });
  }) && palavras.length <= 3;
}

// Pedido pra pular direto pro atendimento humano, sem antes tentar tirar
// a dúvida com a IA ("quero abrir chamado", "falar com o dp/analista/
// atendente/humano"). A ideia não é recusar — é sugerir, com jeito,
// contar a dúvida primeiro (a IA pode resolver na hora), deixando sempre
// a porta aberta pra abrir o chamado mesmo assim se for isso que quer.
var PEDIDO_ATENDENTE_ = [
  /\babrir? (um |o )?chamado\b/, /\bfalar com (o |a |um |uma )?(dp|rh|analista|atendente|pessoa|humano)\b/,
  /\bquero (um |uma )?(analista|atendente|humano)\b/, /\bpreciso de (um |uma )?(analista|atendente|humano)\b/,
  /\bquero atendimento humano\b/, /\bnao quero falar com (a )?ia\b/, /\btransferir? (pra|para) (um )?(analista|atendente)\b/
];

// Sentinela: quando o colaborador clica "Quero abrir chamado mesmo assim"
// depois da sugestão acima, o cliente reenvia este texto — reconhecido
// ANTES de qualquer outra coisa em askAi(), pra ir direto pro chamado sem
// cair de novo no mesmo aviso (senão viraria um loop).
var CONFIRMA_ABRIR_CHAMADO_ = '__quero_abrir_chamado_mesmo_assim__';

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
  if (CORTESIA_.test(normalize_(question)) && palavras <= 5) return 'cortesia';
  if (pareceCortesiaComErro_(question)) return 'cortesia';
  if (pareceRespostaCortesia_(question)) return 'cortesia';
  if (DESPEDIDA_.test(t) && palavras <= 6) return 'despedida';
  for (var k = 0; k < PEDIDO_ATENDENTE_.length; k++) {
    if (PEDIDO_ATENDENTE_[k].test(t) && palavras <= 8) return 'pedido_atendente';
  }
  return 'pergunta';
}

/** Resposta de conversa (não consulta a base, não oferece chamado, não
 * mostra confiança) — é só a IA se comportando como gente. */
function smallTalkAnswer_(intent, seed) {
  if (intent === 'gratidao') {
    return pickVariant_([
      'Que bom que ajudou, beeper! 😊 Fico à disposição — se surgir qualquer outra dúvida de DP, é só me chamar.',
      'Fico feliz em ter ajudado! Se precisar de mais alguma coisa sobre DP, estou por aqui.',
      'Perfeito, era isso mesmo então! Qualquer outra dúvida, é só perguntar.'
    ], seed);
  }
  if (intent === 'cortesia') {
    return pickVariant_([
      'Tudo ótimo por aqui, obrigada por perguntar! 😊 Em que posso te ajudar hoje, beeper?',
      'Tudo bem sim, obrigada! E com você? Me diz o que você precisa que eu procuro pra você.'
    ], seed);
  }
  if (intent === 'saudacao') {
    return pickVariant_([
      'Oi, beeper! Sou a assistente do DP da Beep. Pode perguntar sobre folha de pagamento, férias, benefícios, ponto, documentos — o que você precisar.',
      'Olá! Posso te ajudar com dúvidas de DP: pagamento, férias, benefícios, ponto, atestados e por aí vai. O que você precisa?'
    ], seed);
  }
  return pickVariant_([
    'Até mais! Qualquer dúvida de DP, é só voltar aqui. 👋',
    'Precisando, estou por aqui. Até logo!'
  ], seed);
}

/** Resposta gentil quando o colaborador pede pra pular direto pro humano,
 * sem contar a dúvida — convida a tentar com a IA primeiro (que resolve
 * na hora, quando resolve), mas nunca fecha a porta: o botão já abre o
 * chamado de verdade, sem pedir a mesma coisa duas vezes. */
function ofertaAtendimentoAnswer_(seed) {
  return pickVariant_([
    'Claro, beeper! Antes de acionar o time de DP, me conta qual é sua dúvida — boas chances de eu já resolver na hora. Mas se preferir falar direto com o time, é só clicar abaixo que eu já abro o chamado.',
    'Sem problema! Só que, antes, vale tentar comigo — às vezes eu já respondo na hora e você nem precisa esperar um analista. Me conta o que está acontecendo, ou clique abaixo se preferir ir direto pro chamado.'
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

/**
 * Este FAQ já apareceu nesta conversa (procura o começo do texto da
 * resposta nas mensagens da IA)? Se sim, devolve as palavras de conteúdo
 * que a pergunta ATUAL traz e a pergunta que gerou aquela resposta não
 * tinha — é o que separa repetição de verdade de um acompanhamento
 * legítimo. Devolve null se o FAQ nunca apareceu antes.
 *
 * Um acompanhamento que aprofunda o MESMO assunto com um detalhe novo (ex.:
 * depois de perguntar sobre banco de horas em geral, "e se eu for
 * plantonista, ganho hora extra na folga?") NÃO é repetição — é uma
 * pergunta legítima que o próprio texto do FAQ já cobre. Tratar isso como
 * "já respondi, base não detalha" quebra a conversa: foi exatamente esse
 * o bug relatado (pergunta nova, mesmo FAQ, IA dizendo que não sabia).
 */
function comparaComPerguntaAnterior_(faq, history, currentQuestion, vocabulary) {
  var body = String(faq.Resposta).trim();
  if (body.length < 40) return null;
  var fingerprint = body.substring(0, 60);
  var previousQuestion = null;
  for (var i = 0; i < history.length; i++) {
    if (history[i].role === 'assistant' && history[i].content.indexOf(fingerprint) !== -1) {
      for (var j = i - 1; j >= 0; j--) {
        if (history[j].role === 'user') { previousQuestion = history[j].content; break; }
      }
    }
  }
  if (!previousQuestion) return null;
  if (!currentQuestion || !vocabulary) return { newTokens: [], previousQuestion: previousQuestion };

  var currentTokens = analyzeQuery_(currentQuestion, vocabulary).tokens;
  var previousTokens = analyzeQuery_(previousQuestion, vocabulary).tokens;
  var newTokens = [];
  currentTokens.forEach(function (tok) {
    if (previousTokens.indexOf(tok) === -1 && newTokens.indexOf(tok) === -1) newTokens.push(tok);
  });
  return { newTokens: newTokens, previousQuestion: previousQuestion };
}

/** Este FAQ já foi entregue nesta conversa E a pergunta atual não traz
 * NENHUMA palavra de conteúdo nova? Só então é repetição de verdade. */
function alreadyAnswered_(faq, history, currentQuestion, vocabulary) {
  var info = comparaComPerguntaAnterior_(faq, history, currentQuestion, vocabulary);
  return !!info && info.newTokens.length === 0;
}

/** Quebra o texto do FAQ em frases (separadas por ponto final) — cada
 * frase deste tipo de FAQ costuma cobrir uma regra ou um caso específico
 * (ex.: uma frase para diaristas, outra para plantonistas), então é a
 * unidade certa para apontar "qual pedaço responde isso". */
function splitClauses_(body) {
  return String(body).split(/\.(?:\s+|$)/)
    .map(function (c) { return c.trim(); })
    .filter(function (c) { return c.length > 0; })
    .map(function (c) { return /[.!?]$/.test(c) ? c : c + '.'; });
}

/**
 * Dentro do texto de um FAQ já mostrado antes, acha a frase mais ligada às
 * palavras NOVAS que a pergunta atual trouxe — usado para apontar direto
 * pro trecho que responde o detalhe específico, em vez de devolver o
 * texto inteiro de novo do mesmo jeito (o que rende a queixa "respondeu a
 * mesma coisa, não entendeu o que eu perguntei").
 */
function extractRelevantClause_(body, tokens) {
  if (!tokens || tokens.length === 0) return null;
  var clauses = splitClauses_(body);
  if (clauses.length <= 1) return null;

  var wanted = {};
  tokens.forEach(function (t) { wanted[t] = true; });

  var best = null, bestScore = 0;
  clauses.forEach(function (clause) {
    var clauseTokens = analyzeDocument_(clause);
    var seen = {}, score = 0;
    clauseTokens.forEach(function (t) {
      if (wanted[t] && !seen[t]) { score++; seen[t] = true; }
    });
    if (score > bestScore) { bestScore = score; best = clause; }
  });
  return bestScore > 0 ? best : null;
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

  if (opts.highlight) {
    // Acompanhamento sobre um FAQ já mostrado antes, mas com um detalhe
    // novo que o próprio texto já cobre: em vez de repetir tudo de novo do
    // mesmo jeito, aponta direto pro trecho que responde o que há de novo
    // — só nesse caso o texto completo do FAQ não entra na resposta,
    // porque já foi mostrado por inteiro antes.
    parts.push(pickVariant_([
      'Sim, isso está coberto no que já expliquei sobre ' + dept + ':',
      'Respondendo direto ao seu caso:',
      'Olhando com atenção pro que você perguntou:'
    ], seed));
    parts.push(opts.highlight);
    parts.push('Se quiser rever a regra completa de novo, é só pedir.');
    return parts.join('\n\n');
  }

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
  // Reconhecido ANTES de tudo — é a confirmação de quem já viu o aviso de
  // "conta sua dúvida primeiro" e clicou mesmo assim em ir direto pro
  // chamado. Reconhecer aqui, fora do fluxo normal, evita cair de novo no
  // mesmo aviso (senão viraria um loop).
  if (question === CONFIRMA_ABRIR_CHAMADO_) {
    return {
      answer: 'Combinado! Vamos abrir o chamado então — é só preencher os detalhes abaixo.',
      decision: 'suggest_ticket', confidence: 0, source: null, options: [], steps: [],
      skipHelpfulCheck: true, autoOpenTicket: true
    };
  }

  var recentHistory = normalizeHistory_(history);
  var faqs = rowsAsObjects_(sheet_(SHEETS.FAQS, HEADERS.FAQs)).filter(function (f) {
    return f.Pergunta && f.Resposta;
  });

  if (faqs.length === 0) {
    return {
      answer: 'A base de conhecimento ainda está vazia, então não consigo responder com segurança. Posso abrir um chamado para um analista do DP te ajudar.',
      decision: 'auto_ticket', confidence: 0, source: null, options: [], steps: []
    };
  }

  // Antes de qualquer busca: isto é mesmo uma pergunta? Um "obrigado, era
  // isso!" não deve virar consulta à base de conhecimento.
  var intent = detectIntent_(question, recentHistory);
  if (intent === 'pedido_atendente') {
    return {
      answer: ofertaAtendimentoAnswer_(question),
      decision: 'conversa', confidence: 1, source: null, steps: [],
      options: [{ label: 'Quero abrir chamado mesmo assim', question: CONFIRMA_ABRIR_CHAMADO_ }]
    };
  }
  if (intent === 'gratidao' || intent === 'saudacao' || intent === 'despedida' || intent === 'cortesia') {
    return {
      answer: smallTalkAnswer_(intent, question),
      decision: 'conversa', confidence: 1, source: null, options: [], steps: []
    };
  }

  var index = buildIndex_(faqs);
  var analyzed = analyzeQuery_(question, index.vocabulary);
  var thresholds = getThresholds_();
  var isCorrection = intent === 'correcao';

  // Mensagem sem nenhuma palavra de conteúdo ("???", "aaa", só stopwords):
  // não há o que buscar. Pedir para reformular é mais útil — e menos
  // estranho — do que oferecer abrir um chamado.
  if (analyzed.words.length === 0) {
    return {
      answer: 'Não consegui entender sua mensagem. Pode escrever com outras palavras o que você precisa? ' +
        'Posso ajudar com folha de pagamento, férias, benefícios, ponto, documentos e afins.',
      decision: 'conversa', confidence: 0, source: null, options: [], steps: []
    };
  }

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
      decision: 'auto_ticket', confidence: 0, source: null, options: [], steps: []
    };
  }

  // "Não é isso que eu perguntei": o colaborador está corrigindo o rumo,
  // então o que já foi respondido sai da disputa e a IA tenta a próxima
  // melhor opção, em vez de insistir no mesmo FAQ.
  if (isCorrection) {
    var remaining = ranked.filter(function (r) { return !alreadyAnswered_(r.faq, recentHistory, question, index.vocabulary); });
    if (remaining.length > 0) {
      ranked = remaining;
      confidence = confidenceOf_(ranked[0], analyzed, thresholds);
    }
  }

  var best = ranked[0];

  // O mesmo FAQ já apareceu nesta conversa? Compara com a pergunta que
  // gerou aquela resposta: se a atual não traz nada de novo, é repetição
  // de verdade (a base já deu tudo o que tinha, repetir não ajuda); se
  // traz um detalhe novo que o texto do FAQ já cobre (ex.: "e se eu for
  // plantonista, ganho hora extra na folga?" depois de já ter perguntado
  // sobre banco de horas em geral), não é repetição — é um acompanhamento
  // legítimo, e a resposta aponta direto pro trecho que responde aquilo.
  var repeticao = comparaComPerguntaAnterior_(best.faq, recentHistory, question, index.vocabulary);
  if (repeticao) isFollowUp = true;

  if (repeticao && repeticao.newTokens.length === 0) {
    return {
      answer: 'Sobre ' + (best.faq.Departamento || 'esse assunto') + ' eu já te passei tudo o que a nossa base tem — ' +
        'ela não detalha esse ponto específico que você está perguntando agora. Para não te dar uma resposta ' +
        'incompleta, o melhor caminho é um analista do DP olhar o seu caso. Quer que eu abra o chamado?',
      decision: 'auto_ticket', confidence: confidence,
      source: { department: best.faq.Departamento, question: best.faq.Pergunta }, options: [], steps: []
    };
  }

  var highlight = repeticao ? extractRelevantClause_(String(best.faq.Resposta), repeticao.newTokens) : null;

  if (confidence < thresholds.suggest) {
    return {
      answer: 'Entendi mais ou menos o que você precisa, mas não achei na base algo que responda com segurança — e prefiro não chutar. Quer que eu abra um chamado para um analista do DP olhar seu caso?',
      decision: 'auto_ticket', confidence: confidence,
      source: { department: best.faq.Departamento, question: best.faq.Pergunta }, options: [], steps: []
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
  // Se este FAQ tiver passo a passo ilustrado, ele vai junto: são as
  // etapas que realmente tiram a dúvida de um procedimento de tela.
  var steps = getStepsFor(best.faq.Pergunta);
  // Toda resposta automática (decisão de verdade, sem ressalva) fica
  // registrada pro dashboard — ver comentário em logAiInteraction_.
  var logId = confident ? logAiInteraction_(question, best.faq.Departamento, confidence) : null;
  return {
    answer: composeAnswer_(best.faq, { confident: confident, isFollowUp: isFollowUp, isCorrection: isCorrection, highlight: highlight, seed: question }),
    decision: confident ? 'auto_answer' : 'suggest_ticket',
    confidence: confidence,
    source: { department: best.faq.Departamento, question: best.faq.Pergunta },
    options: [], steps: steps, logId: logId
  };
}

/** Registra uma resposta automática da IA (decisão "auto_answer"), pra dar
 * pro dashboard "quantas dúvidas a IA resolveu sozinha x quantas viraram
 * chamado pra analista" (ver getDashboardStats() em Code.gs). Não depende
 * do colaborador confirmar nada — poucos clicam em "isso resolveu?" mesmo
 * quando resolveu de verdade; a linha nasce na hora da resposta, e o
 * clique (ver markAiInteractionUtil) só marca a coluna Util depois, como
 * satisfação extra, não como condição pra contar. */
function logAiInteraction_(question, department, confidence) {
  var id = Utilities.getUuid();
  appendObject_(sheet_(SHEETS.INTERACOES_IA, HEADERS.InteracoesIA), {
    ID: id, Data: new Date(), Pergunta: String(question || '').slice(0, 500),
    Departamento: department || '', Confianca: Math.round(confidence * 100) / 100, Util: ''
  });
  return id;
}

function markAiInteractionUtil(logId, useful) {
  if (!logId) return;
  var sheet = sheet_(SHEETS.INTERACOES_IA, HEADERS.InteracoesIA);
  var row = findRowById_(sheet, 'ID', logId);
  if (!row) return;
  updateObject_(sheet, row._row, { Util: !!useful });
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
