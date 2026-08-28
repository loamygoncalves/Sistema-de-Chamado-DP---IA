/**
 * Motor de linguagem do BEEP Service Desk — 100% local, sem custo e sem
 * chamada externa: nenhuma informação sai do Google Workspace e nada vem
 * da internet. Só a base de conhecimento da própria empresa (aba FAQs).
 *
 * O objetivo aqui não é "ser inteligente como um LLM", é ENTENDER o
 * colaborador: ele escreve com pressa, abrevia, erra acento e digitação,
 * e usa o nome popular das coisas ("holerite", "VR", "convênio") em vez
 * do nome que está escrito na base. Quatro camadas resolvem isso:
 *
 *   1. Normalização + stemming leve  → "férias"/"feriass"/"FERIAS" viram a
 *      mesma coisa; plural e sufixo comum deixam de atrapalhar.
 *   2. Dicionário de sinônimos do DP → "holerite" e "contracheque" viram o
 *      mesmo conceito. É a camada que mais acerta na prática, porque o
 *      vocabulário do RH é diferente do vocabulário do colaborador.
 *   3. Corretor de digitação (Levenshtein) → "cntracheq" vira
 *      "contracheque", comparando com o vocabulário REAL da base (nunca
 *      inventa palavra que a empresa não usa).
 *   4. Ranqueamento BM25 com IDF → palavra rara e específica ("creche",
 *      "consignado") pesa muito mais do que palavra genérica ("valor"),
 *      que é o que separa a resposta certa da parecida.
 */

var STOPWORDS_ = [
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'é', 'um', 'uma', 'uns', 'umas', 'para', 'com', 'no',
  'na', 'em', 'nos', 'nas', 'que', 'como', 'qual', 'quais', 'meu', 'minha', 'meus', 'minhas', 'me', 'eu', 'ao', 'aos',
  'por', 'se', 'tem', 'tenho', 'sobre', 'sua', 'seu', 'suas', 'seus', 'ou', 'pra', 'pro', 'ta', 'to', 'ai', 'la',
  'ser', 'sao', 'foi', 'era', 'esta', 'estou', 'ele', 'ela', 'isso', 'esse', 'essa', 'este', 'esta', 'aqui', 'mas',
  'mais', 'ja', 'nao', 'sim', 'oi', 'ola', 'bom', 'dia', 'boa', 'tarde', 'noite', 'favor', 'gostaria', 'queria',
  'preciso', 'saber', 'poderia', 'pode', 'consigo', 'tenho', 'fazer', 'ter', 'vou', 'vai', 'estava',
  'quero', 'qero', 'posso', 'onde', 'quando', 'quanto', 'quantos', 'quantas', 'porque', 'porquê', 'entao'
];

/**
 * Vocabulário do colaborador → vocabulário da base. A chave é como a
 * pessoa fala; o valor são os termos que existem de fato nos FAQs.
 * Sem isso, "meu holerite veio errado" não casa com nada, porque a base
 * inteira fala "contracheque".
 */
var SYNONYMS_ = {
  // Folha / pagamento
  holerite: 'contracheque salario pagamento',
  holerith: 'contracheque salario pagamento',
  contra: 'contracheque',
  demonstrativo: 'contracheque salario',
  ordenado: 'salario pagamento',
  remuneracao: 'salario pagamento',
  vencimento: 'salario pagamento',
  pagto: 'pagamento salario',
  // O FAQ do salário se chama "Quando e onde recebo meu SALÁRIO?", mas o
  // do 13º tem "PAGAMENTO" no título. Sem esta ponte, quem pergunta "que
  // dia cai o pagamento" cai no 13º, que é o assunto errado.
  pagamento: 'pagamento salario recebo',
  recebo: 'salario pagamento recebo',
  receber: 'salario pagamento recebo',
  liquido: 'salario pagamento',
  bruto: 'salario pagamento',
  desconto: 'desconto salario contracheque',
  descontado: 'desconto salario contracheque',
  decimo: 'decimo terceiro salario',
  '13': 'decimo terceiro salario',
  '13o': 'decimo terceiro salario',
  natalino: 'decimo terceiro salario',
  adiantamento: 'decimo terceiro salario parcela',
  portabilidade: 'portabilidade salarial banco conta',
  // Férias
  ferias: 'ferias',
  feria: 'ferias',
  descanso: 'ferias',
  aquisitivo: 'ferias periodo aquisitivo',
  gozo: 'ferias periodo',
  // Vale refeição / alimentação
  vr: 'vale refeicao alimentacao',
  va: 'vale alimentacao refeicao',
  'vr/va': 'vale refeicao alimentacao',
  ticket: 'vale refeicao alimentacao cartao',
  alelo: 'vale refeicao alimentacao cartao',
  sodexo: 'vale refeicao alimentacao cartao',
  refeicao: 'vale refeicao alimentacao',
  alimentacao: 'vale alimentacao refeicao',
  // Vale transporte
  vt: 'vale transporte',
  transporte: 'vale transporte',
  passagem: 'vale transporte',
  onibus: 'vale transporte',
  bilhete: 'vale transporte cartao',
  // Saúde
  convenio: 'plano saude bradesco',
  plano: 'plano saude',
  saude: 'plano saude',
  bradesco: 'plano saude bradesco',
  coparticipacao: 'coparticipacao plano saude',
  copart: 'coparticipacao plano saude',
  dependente: 'dependente plano saude inclusao',
  dependentes: 'dependente plano saude inclusao',
  filho: 'dependente filho',
  filha: 'dependente filho',
  conjuge: 'dependente conjuge',
  esposa: 'dependente conjuge',
  marido: 'dependente conjuge',
  odonto: 'odontologico dentista plano',
  dentista: 'odontologico plano',
  odontologico: 'odontologico plano',
  telemedicina: 'telemedicina conexa',
  conexa: 'telemedicina conexa',
  // Benefícios diversos
  metlife: 'seguro vida metlife',
  seguro: 'seguro vida',
  totalpass: 'totalpass academia',
  gympass: 'gympass wellhub academia',
  wellhub: 'gympass wellhub academia',
  academia: 'totalpass gympass wellhub',
  creche: 'auxilio creche',
  babá: 'auxilio creche',
  baba: 'auxilio creche',
  pensao: 'pensao alimenticia oficio',
  alimenticia: 'pensao alimenticia',
  // Ponto / jornada
  ponto: 'ponto marcacao registro',
  batida: 'ponto marcacao registro',
  batidas: 'ponto marcacao registro',
  marcacao: 'ponto marcacao registro',
  biometria: 'ponto biometrico digital',
  digital: 'ponto biometrico',
  adp: 'portal adp ponto contracheque',
  espelho: 'ponto marcacao',
  he: 'hora extra banco horas',
  extra: 'hora extra banco horas',
  extras: 'hora extra banco horas',
  banco: 'banco horas',
  plantonista: 'plantonista escala 12x36',
  diarista: 'diarista escala',
  escala: 'escala jornada',
  // Documentos / cadastro
  cadastro: 'atualizacao cadastral dados',
  cadastral: 'atualizacao cadastral dados',
  endereco: 'atualizacao cadastral endereco dados',
  conta: 'dados bancarios conta',
  atestado: 'atestado ausencia declaracao medico',
  declaracao: 'declaracao documento',
  atestados: 'atestado ausencia declaracao',
  afastamento: 'atestado ausencia licenca',
  falecimento: 'licenca falecimento ausencia',
  obito: 'licenca falecimento ausencia',
  luto: 'licenca falecimento ausencia',
  casamento: 'licenca casamento ausencia',
  paternidade: 'licenca paternidade ausencia',
  maternidade: 'licenca maternidade ausencia',
  // Trabalho
  homeoffice: 'home office hibrido presencial',
  remoto: 'home office hibrido',
  hibrido: 'home office hibrido presencial',
  teletrabalho: 'home office hibrido',
  // "trabalhar de casa" é como o colaborador pergunta; a base fala
  // "home office". Sem esta ponte, a pergunta não casa com nada.
  casa: 'home office hibrido remoto',
  presencial: 'home office hibrido presencial',
  escritorio: 'home office hibrido presencial',
  vacina: 'vacina desconto exame',
  exame: 'exame desconto vacina',
  consignado: 'emprestimo consignado',
  emprestimo: 'emprestimo consignado',
  admissao: 'admissao',
  rescisao: 'rescisao desligamento',
  demissao: 'rescisao desligamento',
  desligamento: 'rescisao desligamento'
};

function normalize_(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ');
}

/** Tira o plural antes dos sufixos derivativos — senão "pagamentos" e
 * "pagamento" acabariam com radicais diferentes e deixariam de casar. */
function depluralize_(w) {
  if (w.length <= 3) return w;
  var rules = [
    [/oes$/, 'ao'], [/aes$/, 'ao'], [/ais$/, 'al'], [/eis$/, 'el'], [/ois$/, 'ol'],
    [/ns$/, 'm'], [/res$/, 'r'], [/zes$/, 'z'], [/ses$/, 's']
  ];
  for (var i = 0; i < rules.length; i++) {
    if (rules[i][0].test(w)) return w.replace(rules[i][0], rules[i][1]);
  }
  if (/s$/.test(w) && w.length > 3) return w.slice(0, -1);
  return w;
}

var STEM_SUFFIXES_ = ['mente', 'amento', 'imento', 'idade', 'ncia', 'ista', 'ivel', 'avel', 'ancia'];

/** Stemming leve: o objetivo não é linguística correta, é que a MESMA
 * palavra escrita de formas diferentes vire o mesmo radical dos dois
 * lados (pergunta e base). Só corta se sobrar radical de 4+ letras. */
function lightStem_(w) {
  var word = depluralize_(w);
  for (var i = 0; i < STEM_SUFFIXES_.length; i++) {
    var suf = STEM_SUFFIXES_[i];
    if (word.length > suf.length + 3 && word.slice(-suf.length) === suf) {
      return word.slice(0, -suf.length);
    }
  }
  return word;
}

/** Palavras "cruas" (sem stem) — usadas para montar vocabulário e para o
 * corretor de digitação trabalhar em cima da forma real escrita. */
function rawWords_(s) {
  return normalize_(s).split(/\s+/).filter(function (w) {
    return w.length > 1 && STOPWORDS_.indexOf(w) === -1;
  });
}

/** Distância de edição com corte: se passar de `maxDist`, aborta cedo —
 * não interessa saber "quão diferente", só se é perto o bastante. */
function levenshtein_(a, b, maxDist) {
  if (a === b) return 0;
  var la = a.length, lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  var prev = new Array(lb + 1), cur = new Array(lb + 1), i, j;
  for (j = 0; j <= lb; j++) prev[j] = j;
  for (i = 1; i <= la; i++) {
    cur[0] = i;
    var best = cur[0];
    for (j = 1; j <= lb; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > maxDist) return maxDist + 1;
    for (j = 0; j <= lb; j++) prev[j] = cur[j];
  }
  return prev[lb];
}

/** Erro de digitação tolerado conforme o tamanho: palavra curta erra
 * pouco (senão "vale" viraria "vaga"), palavra longa pode errar mais. */
function maxTypoDistance_(word) {
  if (word.length <= 4) return 0;
  if (word.length <= 7) return 1;
  return 2;
}

/** Corrige a palavra contra o vocabulário REAL da base (mais os apelidos
 * conhecidos). Nunca inventa termo que a empresa não usa: se nada estiver
 * perto o bastante, devolve a palavra original. */
function correctWord_(word, vocabulary) {
  if (vocabulary.hasOwnProperty(word)) return word;
  var maxDist = maxTypoDistance_(word);
  if (maxDist === 0) return word;
  var best = null, bestDist = maxDist + 1;
  for (var candidate in vocabulary) {
    if (!vocabulary.hasOwnProperty(candidate)) continue;
    var d = levenshtein_(word, candidate, maxDist);
    if (d < bestDist) { bestDist = d; best = candidate; if (d === 1) break; }
  }
  return (best && bestDist <= maxDist) ? best : word;
}

/** Aplica o dicionário de sinônimos: devolve a palavra + os termos
 * canônicos equivalentes (mantém a original, para não perder sinal). */
function expandSynonyms_(word) {
  if (SYNONYMS_.hasOwnProperty(word)) {
    return [word].concat(normalize_(SYNONYMS_[word]).split(/\s+/));
  }
  return [word];
}

/** Pipeline completo da pergunta do colaborador:
 * normalizar → corrigir digitação → expandir sinônimos → stemizar. */
function analyzeQuery_(text, vocabulary) {
  var words = rawWords_(text);
  var corrected = [], expanded = [], recognized = 0;
  words.forEach(function (w) {
    var fixed = vocabulary ? correctWord_(w, vocabulary) : w;
    corrected.push(fixed);
    if (!vocabulary || vocabulary.hasOwnProperty(fixed) || SYNONYMS_.hasOwnProperty(fixed)) recognized++;
    expanded = expanded.concat(expandSynonyms_(fixed));
  });
  var stems = expanded.map(lightStem_).filter(function (t) { return t.length > 1; });
  return {
    words: words, corrected: corrected, tokens: stems,
    // Quanto do que a pessoa escreveu o sistema de fato reconheceu. É a
    // defesa contra a pergunta que traz UMA palavra conhecida e várias
    // estranhas: "qual o horário do ônibus 372?" só entende "ônibus", e
    // sem esse freio responderia sobre vale-transporte com toda a
    // segurança do mundo — errando feio e com cara de certeza.
    recognition: words.length > 0 ? recognized / words.length : 0
  };
}

/** Pipeline da base: normaliza e stemiza, mas NÃO expande sinônimos.
 *
 * A expansão acontece só do lado da pergunta — ela é a ponte que leva o
 * jeito do colaborador falar até o jeito da base falar, e uma ponte só
 * precisa ser atravessada num sentido. Expandir os dois lados injeta na
 * base termos que o FAQ não discute: o FAQ do vale-transporte, que só
 * cita "desconto de 6%", passaria a "conter" contracheque e salário, e
 * responderia a perguntas sobre folha de pagamento — exatamente o tipo
 * de resposta errada e confiante que não pode acontecer aqui. */
function analyzeDocument_(text) {
  return rawWords_(text).map(lightStem_).filter(function (t) { return t.length > 1; });
}

/**
 * Índice de busca sobre os FAQs: guarda os tokens de cada documento, a
 * frequência de documento (df) de cada termo e o vocabulário para o
 * corretor de digitação. A pergunta do FAQ pesa o dobro da resposta —
 * é ela que descreve o assunto; a resposta é o detalhe.
 */
function buildIndex_(faqs) {
  var docs = [], df = {}, vocabulary = {}, totalLen = 0;

  faqs.forEach(function (faq) {
    var questionTokens = analyzeDocument_(faq.Pergunta);
    var answerTokens = analyzeDocument_(faq.Resposta);
    var tokens = questionTokens.concat(questionTokens).concat(answerTokens);

    var tf = {};
    tokens.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
    for (var term in tf) {
      if (tf.hasOwnProperty(term)) df[term] = (df[term] || 0) + 1;
    }
    totalLen += tokens.length;

    // Termos únicos da PERGUNTA do FAQ = o assunto dele. Guardados à parte
    // para medir "foco" na hora de ranquear (ver rankDocuments_).
    var topic = [];
    questionTokens.forEach(function (t) { if (topic.indexOf(t) === -1) topic.push(t); });
    docs.push({ faq: faq, tf: tf, length: tokens.length, topic: topic });

    // Vocabulário do corretor usa a palavra crua (como o colaborador de
    // fato digita) e também o singular dela: a base escreve
    // "contracheques", mas quem pergunta digita "contracheque" — sem o
    // singular no vocabulário, um erro de digitação nessa palavra ficaria
    // longe demais de qualquer candidato e não seria corrigido.
    rawWords_(faq.Pergunta).concat(rawWords_(faq.Resposta)).forEach(function (w) {
      vocabulary[w] = true;
      vocabulary[depluralize_(w)] = true;
    });
  });

  for (var alias in SYNONYMS_) {
    if (SYNONYMS_.hasOwnProperty(alias)) vocabulary[alias] = true;
  }

  return {
    docs: docs, df: df, total: docs.length, vocabulary: vocabulary,
    avgLength: docs.length ? totalLen / docs.length : 0
  };
}

function idf_(index, term) {
  var df = index.df[term] || 0;
  return Math.log(1 + (index.total - df + 0.5) / (df + 0.5));
}

/**
 * Ranqueia os FAQs para a pergunta usando BM25. Devolve também a
 * "cobertura": quanto do peso da pergunta (em IDF) foi de fato
 * encontrado no documento. A cobertura é o que vira confiança — ela é
 * limitada entre 0 e 1 e responde à pergunta certa ("a base cobre o que
 * ele perguntou?"), enquanto o BM25 cru é ilimitado e só serve para
 * ordenar entre candidatos.
 */
function rankDocuments_(queryTokens, index) {
  var k1 = 1.5, b = 0.75;
  var unique = [];
  queryTokens.forEach(function (t) { if (unique.indexOf(t) === -1) unique.push(t); });
  if (unique.length === 0 || index.total === 0) return [];

  // A confiança é medida SÓ sobre os termos que existem na base. Uma
  // palavra que não aparece em nenhum FAQ (erro de digitação que o
  // corretor não alcançou, gíria solta, ou termo fora do domínio) não diz
  // nada sobre qual resposta é a certa — se entrasse na conta, "cmo faço
  // pra pedir ferias" seria punida por "cmo" e "pedir" e a IA se recusaria
  // a dar a resposta de férias que ela achou corretamente.
  var known = unique.filter(function (t) { return (index.df[t] || 0) > 0; });
  if (known.length === 0) return [];

  var totalIdf = 0;
  known.forEach(function (t) { totalIdf += idf_(index, t); });

  var results = index.docs.map(function (doc) {
    var score = 0, matchedIdf = 0;
    known.forEach(function (term) {
      var tf = doc.tf[term] || 0;
      if (tf === 0) return;
      var termIdf = idf_(index, term);
      var norm = 1 - b + b * (doc.length / (index.avgLength || 1));
      score += termIdf * (tf * (k1 + 1)) / (tf + k1 * norm);
      matchedIdf += termIdf;
    });

    // "Foco": quanto do ASSUNTO do FAQ a pergunta cobriu. Sem isso, um FAQ
    // que só CITA o termo de passagem ("benefícios extras de VT e VR/VA")
    // vence o FAQ que é DE FATO sobre aquilo ("Como funciona o Vale
    // Refeição?"), porque cita mais termos no total. O foco desempata a
    // favor de quem tem o assunto certo, não de quem tem mais palavras.
    var topicIdf = 0, topicMatched = 0;
    doc.topic.forEach(function (term) {
      var termIdf = idf_(index, term);
      topicIdf += termIdf;
      if (known.indexOf(term) !== -1) topicMatched += termIdf;
    });
    var focus = topicIdf > 0 ? topicMatched / topicIdf : 0;

    // O peso do foco é alto de propósito: um FAQ "guarda-chuva" que cita
    // vários benefícios acumula naturalmente mais ocorrências e venceria
    // no BM25 puro quase sempre. Com este peso, quem é DE FATO sobre o
    // assunto perguntado passa na frente de quem só menciona o termo.
    return {
      faq: doc.faq,
      score: score * (0.25 + 0.75 * focus),
      coverage: totalIdf > 0 ? matchedIdf / totalIdf : 0,
      focus: focus
    };
  });

  results.sort(function (x, y) { return y.score - x.score; });
  return results.filter(function (r) { return r.score > 0; });
}
