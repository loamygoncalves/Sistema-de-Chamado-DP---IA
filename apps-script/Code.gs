/**
 * BEEP AI Service Desk — protótipo em Google Apps Script.
 *
 * Versão simplificada do sistema real (FastAPI + Postgres + Next.js):
 * usa a própria planilha como banco de dados, HtmlService para a tela, e
 * MailApp para notificações. Sem fila assíncrona, sem RAG vetorial — a
 * "IA" usa casamento léxico de FAQs (ver AiService.gs) e, se uma chave da
 * API da Anthropic estiver configurada em Script Properties, usa Claude
 * para responder de forma mais natural e para sintetizar o contexto do
 * chamado. Sem a chave, tudo funciona do mesmo jeito, só que com respostas
 * mais literais.
 *
 * Ver README.md nesta pasta para o passo a passo de instalação.
 */

var SHEETS = {
  DEPARTAMENTOS: 'Departamentos',
  ANALISTAS: 'Analistas',
  COLABORADORES: 'Colaboradores',
  CHAMADOS: 'Chamados',
  HISTORICO: 'Historico',
  RESPOSTAS_PADRAO: 'RespostasPadrao',
  FAQS: 'FAQs',
  PASSOS: 'Passos',
  ANEXOS: 'Anexos',
  INTERACOES_IA: 'InteracoesIA'
};

var HEADERS = {
  Departamentos: ['Nome', 'PrioridadePadrao', 'SlaHorasMax'],
  Analistas: ['Nome', 'Email', 'Ativo'],
  // Diretório oficial vindo da ADP (só colaboradores ativos — reimportar por
  // cima a cada atualização já revoga quem foi desligado, sem precisar de
  // coluna de status). Usado pra reconhecer o colaborador pelo e-mail da
  // conta Google, e o CPF como confirmação de identidade pra quem não tem
  // e-mail Google cadastrado (ver verifyCpf() — CPF, não Matrícula, porque
  // matrícula costuma ser um número sequencial fácil de adivinhar/saber de
  // outro colaborador; CPF não). UserKeyVerificado/DataVerificacao vinculam
  // esse CPF à conta Google que o confirmou primeiro — sem isso, qualquer
  // pessoa logada que soubesse o CPF de outra pessoa conseguia "entrar" como
  // ela (bug real encontrado em teste, corrigido aqui).
  Colaboradores: [
    'Matricula', 'CPF', 'Nome', 'Email', 'Filial', 'DataAdmissao', 'Celular',
    'UserKeyVerificado', 'DataVerificacao'
  ],
  Chamados: [
    'ID', 'Protocolo', 'DataAbertura', 'SolicitanteNome', 'SolicitanteEmail', 'Matricula',
    'Departamento', 'Categoria', 'Assunto', 'Descricao', 'Prioridade', 'Status',
    'AnalistaResponsavel', 'PrazoSLA', 'DataFechamento', 'MotivoFechamento', 'Origem'
  ],
  Historico: ['ID', 'ChamadoID', 'Autor', 'Papel', 'Interno', 'Mensagem', 'DataHora'],
  RespostasPadrao: ['ID', 'Titulo', 'Conteudo', 'Departamento'],
  FAQs: ['Pergunta', 'Resposta', 'Departamento'],
  // Passo a passo ilustrado de um FAQ: uma linha por etapa, ligada ao FAQ
  // pelo texto da Pergunta. Cada etapa tem o SEU texto e a SUA imagem —
  // uma lista solta de imagens no fim da resposta perderia esse par.
  Passos: ['Pergunta', 'Ordem', 'Titulo', 'Texto', 'Imagem'],
  Anexos: ['ID', 'ChamadoID', 'NomeArquivo', 'URL', 'EnviadoPor', 'DataHora'],
  // Uma linha por resposta automática da IA (decisão "auto_answer") — pra
  // o dashboard poder mostrar quantas dúvidas a IA resolveu sozinha, sem
  // virar chamado. Não depende do colaborador confirmar nada: a linha
  // nasce na hora da resposta; Util só é preenchida se ele clicar
  // "Sim"/"Não" depois (dado extra de satisfação, não é o que conta).
  InteracoesIA: ['ID', 'Data', 'Pergunta', 'Departamento', 'Confianca', 'Util']
};

var SLA_HORAS_POR_PRIORIDADE = { baixa: 72, media: 48, alta: 24, critica: 4 };

var STATUS = {
  EM_TRIAGEM: 'em_triagem',
  EM_ATENDIMENTO: 'em_atendimento',
  AGUARDANDO_USUARIO: 'aguardando_usuario',
  RESOLVIDO: 'resolvido',
  ENCERRADO: 'encerrado'
};

var MOTIVOS_ENCERRAMENTO = {
  resolvido: {
    label: 'Resolvido',
    message: 'Seu chamado foi resolvido. Agradecemos o contato! Se surgir qualquer nova dúvida, é só abrir um novo chamado que seguimos te ajudando.'
  },
  sem_interatividade: {
    label: 'Encerrado por falta de interatividade',
    message: 'Estamos encerrando este chamado por falta de retorno. Agradecemos o contato! Se ainda precisar de ajuda com esse assunto, é só abrir um novo chamado.'
  },
  duplicado: {
    label: 'Duplicado de outro chamado',
    message: 'Este chamado foi encerrado porque já existe outro em andamento sobre o mesmo assunto — o atendimento segue por lá. Agradecemos o contato!'
  },
  resolvido_pelo_colaborador: { label: 'Já resolvido pelo colaborador', message: 'Encerrado pelo colaborador: assunto já resolvido.' },
  cancelado_pelo_colaborador: { label: 'Cancelado pelo colaborador', message: 'Encerrado pelo colaborador: não é mais necessário.' }
};

/* ============================================================
   Servir a página
   ============================================================ */

/**
 * Rotas de administração, disponíveis só para o dono do app (quem publicou
 * a implantação) ou para quem estiver ativo na aba "Analistas". Servem para
 * atualizar a base sem abrir o editor de script — útil depois de uma
 * atualização que traga conteúdo novo.
 *
 * O app roda "como" o dono, então getEffectiveUser() é sempre ele;
 * getActiveUser() é quem está chamando. Se forem a mesma pessoa, libera.
 * Caso contrário, libera também se quem chamou estiver na aba Analistas
 * (equipe de DP com acesso de edição à planilha/projeto). Para qualquer
 * outro colaborador o parâmetro é ignorado e ele vê o sistema normal.
 */
function handleAdminRoute_(action, e) {
  var dono = Session.getEffectiveUser().getEmail();
  var chamador = Session.getActiveUser().getEmail();
  if (!chamador || !dono) {
    return ContentService.createTextOutput('Rota restrita ao dono do aplicativo.');
  }
  var ehDono = chamador.trim().toLowerCase() === dono.trim().toLowerCase();
  var ehAnalista = rowsAsObjectsCached_(SHEETS.ANALISTAS, HEADERS.Analistas, 30).some(function (a) {
    return String(a.Email).trim().toLowerCase() === chamador.trim().toLowerCase() && a.Ativo;
  });
  if (!ehDono && !ehAnalista) {
    return ContentService.createTextOutput('Rota restrita ao dono do aplicativo.');
  }

  if (action === 'setup') {
    initializeSpreadsheet();
    return ContentService.createTextOutput('OK: base atualizada. ' + resumoDaBase_());
  }

  // Preenche a coluna Imagem das etapas de um FAQ, na ordem, a partir de
  // uma lista de IDs/links do Drive separados por vírgula.
  if (action === 'imagens') {
    var faq = e.parameter.faq || '';
    var ids = String(e.parameter.ids || '').split(',').filter(function (x) { return x.trim(); });
    return ContentService.createTextOutput(setStepImages_(faq, ids));
  }

  return ContentService.createTextOutput('Ação desconhecida.');
}

function resumoDaBase_() {
  return 'FAQs: ' + Math.max(0, sheet_(SHEETS.FAQS, HEADERS.FAQs).getLastRow() - 1) +
    ' | Passos: ' + Math.max(0, sheet_(SHEETS.PASSOS, HEADERS.Passos).getLastRow() - 1);
}

/** Grava os links de imagem nas etapas de um FAQ, na ordem em que vierem. */
function setStepImages_(faqQuestion, ids) {
  var sheet = sheet_(SHEETS.PASSOS, HEADERS.Passos);
  var alvo = String(faqQuestion).trim().toLowerCase();
  var linhas = rowsAsObjects_(sheet)
    .filter(function (p) { return String(p.Pergunta).trim().toLowerCase() === alvo; })
    .sort(function (a, b) { return Number(a.Ordem || 0) - Number(b.Ordem || 0); });
  if (linhas.length === 0) return 'Nenhuma etapa encontrada para: ' + faqQuestion;

  var gravadas = 0;
  linhas.forEach(function (linha, i) {
    if (i >= ids.length) return;
    updateObject_(sheet, linha._row, { Imagem: ids[i].trim() });
    gravadas++;
  });
  return 'OK: ' + gravadas + ' de ' + linhas.length + ' etapas com imagem.';
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.admin) ? String(e.parameter.admin) : '';
  if (action) return handleAdminRoute_(action, e);

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('BEEP AI Service Desk')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ============================================================
   Sessão / identidade
   ============================================================ */

/** CPF só com dígitos, sempre com 11 posições (zero à esquerda incluído).
 * Necessário porque planilha/Excel costuma guardar CPF como NÚMERO — um
 * CPF que começa com 0 perde esse 0 e fica com só 10 dígitos na base. Sem
 * normalizar dos dois lados (o que está na planilha E o que a pessoa
 * digita) esses CPFs nunca bateriam. */
function normalizeCpf_(value) {
  var digits = String(value === undefined || value === null ? '' : value).replace(/\D/g, '');
  if (!digits) return '';
  while (digits.length < 11) digits = '0' + digits;
  return digits;
}

/** Papel do usuário logado é decidido pela aba "Analistas": se o e-mail da
 * conta Google atual estiver lá (e Ativo=TRUE), ele é analista.
 *
 * Senão, é colaborador — e como nem todo colaborador tem e-mail de domínio
 * (a implantação aceita qualquer conta Google, não só @beepsaude), a
 * identidade dele é conferida contra a aba "Colaboradores" (importada da
 * ADP, só gente ativa): primeiro pelo e-mail da conta logada, e se não
 * bater, pelo CPF que ele já confirmou antes NESTA MESMA conta Google (ver
 * verifyCpf() — o vínculo com a conta é o que impede outra pessoa de usar
 * o mesmo CPF pra "entrar" como alguém que não é ela). Sem bater nenhum
 * dos dois, `verified` vem `false` e o cliente mostra a tela pedindo o
 * CPF — é essa checagem que também tira o acesso de quem foi desligado: a
 * próxima vez que a aba Colaboradores for atualizada (reimportação
 * substitui tudo), o CPF/e-mail dessa pessoa somem de lá e nem o e-mail
 * nem o CPF salvo batem mais.
 *
 * NUNCA usar Session.getEffectiveUser() aqui para descobrir QUEM ESTÁ
 * CHAMANDO — como a implantação roda "como" quem publicou (USER_DEPLOYING),
 * getEffectiveUser() sempre devolve o e-mail do dono do deploy, não de quem
 * abriu o link. Um fallback assim (existiu aqui e foi removido depois de um
 * caso real) faz QUALQUER pessoa cujo e-mail não seja detectável por
 * getActiveUser() ser identificada como o dono — inclusive como analista,
 * se o dono estiver na aba Analistas. Sem e-mail detectável, o certo é
 * tratar como colaborador não verificado (cai na tela de CPF). */
function getCurrentUser() {
  var email = (Session.getActiveUser().getEmail() || '').trim();
  // getCurrentUser() roda em praticamente toda ação do sistema — cache
  // curto aqui (Analistas/Colaboradores mudam raramente) é o que mais
  // reduz a quantidade de vezes que a planilha inteira é lida por sessão.
  var analistas = rowsAsObjectsCached_(SHEETS.ANALISTAS, HEADERS.Analistas, 30);
  var analyst = analistas.filter(function (a) {
    return String(a.Email).trim().toLowerCase() === email.toLowerCase() && a.Ativo;
  })[0];
  if (analyst) {
    return { email: email, name: analyst.Nome, role: 'analyst', verified: true, matricula: '', filial: '', dataAdmissao: '' };
  }

  var colaboradores = rowsAsObjectsCached_(SHEETS.COLABORADORES, HEADERS.Colaboradores, 30);
  var porEmail = email ? colaboradores.filter(function (c) {
    return String(c.Email).trim().toLowerCase() === email.toLowerCase();
  })[0] : null;

  // Sem bater o e-mail: só reconhece pelo CPF salvo se ele já foi
  // confirmado ANTES por ESTA MESMA conta Google (userKey). Sem essa
  // segunda condição, o CPF salvo (por qualquer motivo) seria suficiente
  // sozinho — que era exatamente o bug: qualquer conta Google digitando o
  // CPF certo virava a outra pessoa, sem checar se é ela mesma de fato.
  var porCpfSalvo = null;
  if (!porEmail) {
    var cpfSalvo = getVerifiedCpf_();
    if (cpfSalvo) {
      var userKeyAtual = Session.getTemporaryActiveUserKey();
      porCpfSalvo = colaboradores.filter(function (c) {
        return normalizeCpf_(c.CPF) === cpfSalvo &&
          String(c.UserKeyVerificado || '').trim() === userKeyAtual;
      })[0] || null;
    }
  }
  var colaborador = porEmail || porCpfSalvo;
  // Contas Google fora do domínio da empresa muitas vezes não expõem o
  // e-mail pra getActiveUser() (limitação do Google, não tem como forçar) —
  // por isso, reconhecido o colaborador (mesmo só pelo CPF), usa-se o
  // e-mail cadastrado na ADP como identidade dele daqui pra frente. Sem
  // isso o chamado nascia com SolicitanteEmail vazio: a notificação de
  // e-mail não tinha pra quem mandar, e diferentes colaboradores sem
  // e-mail detectado apareceriam com a mesma identidade ("").
  var emailIdentidade = colaborador ? (colaborador.Email || email) : email;

  return {
    email: emailIdentidade,
    name: colaborador ? colaborador.Nome : (getMyProfile_().name || (email ? email.split('@')[0] : 'Colaborador')),
    role: 'employee',
    verified: !!colaborador,
    matricula: colaborador ? colaborador.Matricula : (getMyProfile_().matricula || ''),
    filial: colaborador ? colaborador.Filial : '',
    dataAdmissao: colaborador ? toIso_(colaborador.DataAdmissao) : ''
  };
}

function requireAnalyst_(user) {
  if (user.role !== 'analyst') throw new Error('Ação restrita a analistas.');
}

/**
 * Confere o CPF digitado contra a aba Colaboradores (importada da ADP).
 * Usada por quem não tem e-mail de conta Google cadastrado — depois de
 * confirmado uma vez, fica salvo por conta Google (UserProperties) e
 * getCurrentUser() volta a reconhecer sozinho nas próximas visitas.
 *
 * A trava de segurança está aqui: a PRIMEIRA conta Google a confirmar um
 * CPF fica "dona" dele (grava o userKey na aba Colaboradores) — qualquer
 * outra conta que tentar confirmar o MESMO CPF depois é recusada. Sem
 * isso, CPF (ou matrícula, como era antes) vira só um número que, se
 * descoberto, deixa qualquer pessoa logada se passar por outra — foi
 * exatamente esse bug que aconteceu (colaborador testou de propósito com
 * uma matrícula de outra pessoa e "entrou" como ela).
 *
 * Se a mesma pessoa legitimamente trocar de conta Google (não deveria
 * acontecer, mas pode), quem administra a planilha pode limpar as células
 * UserKeyVerificado/DataVerificacao da linha dela na aba Colaboradores
 * pra liberar uma nova confirmação.
 */
function verifyCpf(cpf) {
  var normalizado = normalizeCpf_(cpf);
  if (!normalizado) throw new Error('Informe seu CPF.');

  var sheet = sheet_(SHEETS.COLABORADORES, HEADERS.Colaboradores);
  var colaborador = rowsAsObjects_(sheet)
    .filter(function (c) { return normalizeCpf_(c.CPF) === normalizado; })[0];
  if (!colaborador) throw new Error('CPF não encontrado. Confira o número ou fale com o time de DP.');

  var userKeyAtual = Session.getTemporaryActiveUserKey();
  var donoAtual = String(colaborador.UserKeyVerificado || '').trim();
  if (donoAtual && donoAtual !== userKeyAtual) {
    throw new Error(
      'Esse CPF já foi confirmado antes em outra conta Google. Se você mudou de conta ou acha ' +
      'que isso é um engano, fale com o time de DP para liberar uma nova confirmação.'
    );
  }
  if (!donoAtual) {
    updateObject_(sheet, colaborador._row, { UserKeyVerificado: userKeyAtual, DataVerificacao: new Date() });
    // getCurrentUser() lê Colaboradores com cache curto (ver
    // rowsAsObjectsCached_) — sem isto, quem acabou de confirmar podia
    // cair de novo na tela de CPF por até o TTL do cache, se recarregasse
    // a página logo em seguida.
    invalidateRowsCache_(SHEETS.COLABORADORES);
  }

  saveVerifiedCpf_(normalizado);
  saveMyProfile_(colaborador.Nome, colaborador.Matricula);
  // Monta o resultado a partir do `colaborador` que acabou de ser achado,
  // em vez de chamar getCurrentUser() de novo — evita depender de uma
  // segunda busca bater exatamente igual à que já confirmamos agora.
  return {
    // Mesmo critério de getCurrentUser(): prefere o e-mail cadastrado na
    // ADP, já que a conta Google de quem confirma por CPF muitas vezes
    // não é detectável (ver comentário em getCurrentUser()).
    email: colaborador.Email || (Session.getActiveUser().getEmail() || '').trim(),
    name: colaborador.Nome,
    role: 'employee',
    verified: true,
    matricula: colaborador.Matricula,
    filial: colaborador.Filial,
    dataAdmissao: toIso_(colaborador.DataAdmissao)
  };
}

/** Nome/matrícula ficam salvos por conta Google (UserProperties) só como
 * conveniência de PRÉ-PREENCHIMENTO do formulário de abertura de chamado —
 * não têm nenhum papel na verificação de identidade (isso é só o CPF
 * vinculado, ver getVerifiedCpf_/saveVerifiedCpf_ abaixo). Names/matrícula
 * digitados livremente ao abrir um chamado NÃO viram identidade verificada
 * pra ninguém. */
function getMyProfile_() {
  var props = PropertiesService.getUserProperties();
  return { name: props.getProperty('nome') || '', matricula: props.getProperty('matricula') || '' };
}

/** CPF confirmado por ESTA conta Google — separado do "profile" de
 * pré-preenchimento acima de propósito: este valor É usado por
 * getCurrentUser() pra decidir identidade, então só pode ser gravado pelo
 * fluxo estrito de verifyCpf() (com a trava de vínculo por conta). */
function getVerifiedCpf_() {
  return PropertiesService.getUserProperties().getProperty('cpfVerificado') || '';
}

function saveVerifiedCpf_(cpfNormalizado) {
  PropertiesService.getUserProperties().setProperty('cpfVerificado', cpfNormalizado);
}

function saveMyProfile_(name, matricula) {
  var props = PropertiesService.getUserProperties();
  props.setProperty('nome', name);
  props.setProperty('matricula', matricula || '');
}

/* ============================================================
   Departamentos / analistas / FAQs
   ============================================================ */

function getDepartments() {
  return rowsAsObjects_(sheet_(SHEETS.DEPARTAMENTOS, HEADERS.Departamentos)).map(function (d) {
    return { name: d.Nome, defaultPriority: d.PrioridadePadrao, slaHorasMax: d.SlaHorasMax || null };
  });
}

function getAnalysts() {
  return rowsAsObjectsCached_(SHEETS.ANALISTAS, HEADERS.Analistas, 30)
    .filter(function (a) { return a.Ativo; })
    .map(function (a) { return { name: a.Nome, email: a.Email }; });
}

/* ============================================================
   Chamados
   ============================================================ */

function nextProtocol_() {
  var props = PropertiesService.getScriptProperties();
  var seq = Number(props.getProperty('ticketSeq') || '100') + 1;
  props.setProperty('ticketSeq', String(seq));
  return 'BEEP-' + ('000000' + seq).slice(-6);
}

/** SLA em "horas úteis" simplificado: pula sábado/domingo, mas não feriados
 * (o backend real usa um calendário de feriados nacionais — aqui não). */
/** Horário comercial: segunda a sexta, das 9h às 18h. Fora disso (noite,
 * madrugada, fim de semana) não conta como tempo de SLA passando. */
function dentroDoHorarioComercial_(date) {
  var dia = date.getDay();
  var hora = date.getHours();
  return dia >= 1 && dia <= 5 && hora >= 9 && hora < 18;
}

function computeSlaDueAt_(priority, slaHorasMax) {
  var hours = SLA_HORAS_POR_PRIORIDADE[priority] || 48;
  if (slaHorasMax) hours = Math.min(hours, Number(slaHorasMax));
  var date = new Date();
  var remaining = hours;
  while (remaining > 0) {
    date = new Date(date.getTime() + 60 * 60 * 1000);
    if (dentroDoHorarioComercial_(date)) remaining -= 1;
  }
  return date;
}

/**
 * google.script.run não entrega Date de volta ao navegador direito nesta
 * combinação de Chrome/Apps Script — o retorno some e o sucesso vira `null`
 * sem exceção nenhuma (bug real encontrado e confirmado num teste isolado).
 * Por isso toda data que sai daqui vira string ISO; o cliente já usa
 * `new Date(...)` em cima do que recebe, então funciona igual.
 */
function toIso_(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
  return String(value);
}

/** Email → Nome de cada analista ativo — pra mostrar o nome do responsável
 * em vez do e-mail (AnalistaResponsavel só guarda o e-mail, que é a chave
 * usada pra atribuir/transferir). Montado uma vez e passado adiante em
 * listTickets(), pra não reler a aba Analistas a cada linha. */
function analistasPorEmail_() {
  var mapa = {};
  rowsAsObjectsCached_(SHEETS.ANALISTAS, HEADERS.Analistas, 30).forEach(function (a) {
    mapa[String(a.Email).trim().toLowerCase()] = a.Nome;
  });
  return mapa;
}

function serializeTicket_(t, analistasByEmail) {
  var mapa = analistasByEmail || analistasPorEmail_();
  var email = t.AnalistaResponsavel || '';
  return {
    id: t.ID,
    protocol: t.Protocolo,
    openedAt: toIso_(t.DataAbertura),
    requesterName: t.SolicitanteNome,
    requesterEmail: t.SolicitanteEmail,
    matricula: t.Matricula,
    department: t.Departamento,
    category: t.Categoria,
    subject: t.Assunto,
    description: t.Descricao,
    priority: t.Prioridade,
    status: t.Status,
    assignedTo: email || null,
    assignedToName: email ? (mapa[email.trim().toLowerCase()] || email) : null,
    slaDueAt: toIso_(t.PrazoSLA),
    closedAt: toIso_(t.DataFechamento),
    closureReason: t.MotivoFechamento || null,
    source: t.Origem
  };
}

function serializeHistory_(h) {
  return { id: h.ID, author: h.Autor, role: h.Papel, internal: !!h.Interno, body: h.Mensagem, at: toIso_(h.DataHora) };
}

function addHistoryEntry_(ticketId, author, role, internal, body) {
  appendObject_(sheet_(SHEETS.HISTORICO, HEADERS.Historico), {
    ID: Utilities.getUuid(), ChamadoID: ticketId, Autor: author, Papel: role,
    Interno: internal, Mensagem: body, DataHora: new Date()
  });
}

/** Abre um chamado. `payload`: {name, matricula, department, category,
 * subject, description, priority?, source?}. O chamado nasce em
 * "em_triagem" (sem analista, na caixa de entrada geral) — igual ao
 * sistema real. */
function openTicket(payload) {
  saveMyProfile_(payload.name, payload.matricula);
  var user = getCurrentUser();
  var dept = getDepartments().filter(function (d) { return d.name === payload.department; })[0];
  if (!dept) throw new Error('Departamento inválido: ' + payload.department);
  var priority = payload.priority || dept.defaultPriority || 'media';
  var slaDueAt = computeSlaDueAt_(priority, dept.slaHorasMax);
  var id = Utilities.getUuid();
  var ticket = {
    ID: id, Protocolo: nextProtocol_(), DataAbertura: new Date(),
    SolicitanteNome: payload.name, SolicitanteEmail: user.email, Matricula: payload.matricula,
    Departamento: payload.department, Categoria: payload.category || '',
    Assunto: payload.subject, Descricao: payload.description,
    Prioridade: priority, Status: STATUS.EM_TRIAGEM, AnalistaResponsavel: '',
    PrazoSLA: slaDueAt, DataFechamento: '', MotivoFechamento: '',
    Origem: payload.source || 'manual'
  };
  appendObject_(sheet_(SHEETS.CHAMADOS, HEADERS.Chamados), ticket);
  addHistoryEntry_(id, payload.name, 'colaborador', false, payload.description);
  notifyEmail_(ticket, 'aberto');
  return getTicketDetail(id);
}

function getTicketDetail(ticketId) {
  var chamadosSheet = sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  var ticket = findRowById_(chamadosSheet, 'ID', ticketId);
  if (!ticket) throw new Error('Chamado não encontrado.');
  var user = getCurrentUser();
  var isOwner = ticket.SolicitanteEmail === user.email;
  if (!isOwner && user.role !== 'analyst') throw new Error('Sem permissão para ver este chamado.');

  var history = rowsAsObjects_(sheet_(SHEETS.HISTORICO, HEADERS.Historico))
    .filter(function (h) { return h.ChamadoID === ticketId; })
    .filter(function (h) { return user.role === 'analyst' || !h.Interno; })
    .sort(function (a, b) { return new Date(a.DataHora) - new Date(b.DataHora); });

  return {
    ticket: serializeTicket_(ticket),
    history: history.map(serializeHistory_),
    attachments: listAttachments(ticketId),
    colaborador: colaboradorInfoPorMatricula_(ticket.Matricula)
  };
}

/** Dados extra do colaborador (Filial, Celular, DataAdmissao) vindos da aba
 * Colaboradores, pra completar o card do solicitante no chamado — o
 * cadastro de abertura só pede Nome/Matrícula, o resto quem já tem é a ADP.
 * Sem bater a matrícula (chamado antigo, ou colaborador fora da base),
 * devolve null e o card mostra só o que já tinha antes. */
function colaboradorInfoPorMatricula_(matricula) {
  var mat = String(matricula || '').trim();
  if (!mat) return null;
  var colaborador = rowsAsObjectsCached_(SHEETS.COLABORADORES, HEADERS.Colaboradores, 30)
    .filter(function (c) { return String(c.Matricula).trim() === mat; })[0];
  if (!colaborador) return null;
  return {
    filial: colaborador.Filial || '',
    celular: colaborador.Celular || '',
    dataAdmissao: toIso_(colaborador.DataAdmissao)
  };
}

/** Lista chamados filtrados. `filters`: {unassigned, mine, status,
 * department, overdue, pendingAnalyst, q}. Colaborador só vê os próprios
 * chamados, independente dos filtros — os filtros de fila (caixa de
 * entrada etc.) só valem para analistas. */
function listTickets(filters) {
  filters = filters || {};
  var user = getCurrentUser();
  var tickets = rowsAsObjects_(sheet_(SHEETS.CHAMADOS, HEADERS.Chamados));

  if (user.role !== 'analyst') {
    tickets = tickets.filter(function (t) { return t.SolicitanteEmail === user.email; });
  } else {
    // Caixa de entrada = só quem está esperando ser vinculado — um chamado
    // já encerrado sem ter sido assumido (finalizado direto da fila geral)
    // não é mais "pendente", então some daqui e só aparece na aba
    // Encerrados.
    if (filters.unassigned) tickets = tickets.filter(function (t) { return !t.AnalistaResponsavel && t.Status !== STATUS.ENCERRADO; });
    if (filters.mine) tickets = tickets.filter(function (t) { return t.AnalistaResponsavel === user.email; });
  }
  if (filters.status) tickets = tickets.filter(function (t) { return t.Status === filters.status; });
  if (filters.department) tickets = tickets.filter(function (t) { return t.Departamento === filters.department; });
  if (filters.overdue) {
    tickets = tickets.filter(function (t) {
      return t.PrazoSLA && new Date(t.PrazoSLA) < new Date() && t.Status !== STATUS.RESOLVIDO && t.Status !== STATUS.ENCERRADO;
    });
  }
  if (filters.pendingAnalyst) {
    tickets = tickets.filter(function (t) { return t.Status === STATUS.EM_TRIAGEM || t.Status === STATUS.EM_ATENDIMENTO; });
  }
  if (filters.q) {
    var needle = String(filters.q).toLowerCase();
    tickets = tickets.filter(function (t) {
      return [t.Protocolo, t.Matricula, t.SolicitanteNome, t.Assunto].some(function (f) {
        return String(f || '').toLowerCase().indexOf(needle) !== -1;
      });
    });
  }
  tickets.sort(function (a, b) { return new Date(b.DataAbertura) - new Date(a.DataAbertura); });
  var analistas = analistasPorEmail_();
  return tickets.map(function (t) { return serializeTicket_(t, analistas); });
}

function addComment(ticketId, body, isInternal, newStatus) {
  var user = getCurrentUser();
  var sheet = sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  var ticket = findRowById_(sheet, 'ID', ticketId);
  if (!ticket) throw new Error('Chamado não encontrado.');
  var isOwner = ticket.SolicitanteEmail === user.email;
  if (!isOwner && user.role !== 'analyst') throw new Error('Sem permissão.');
  // O analista só responde depois de vincular o chamado a alguém — é o que
  // tira o chamado da caixa de entrada geral. Só visualizar (com os dados
  // do colaborador) continua liberado sem vínculo, é só responder que pede.
  if (user.role === 'analyst' && !ticket.AnalistaResponsavel) {
    throw new Error('Vincule este chamado a um analista antes de responder (use "Assumir para mim").');
  }

  var isInternalNote = user.role === 'analyst' && !!isInternal;
  addHistoryEntry_(ticketId, user.name, user.role === 'analyst' ? 'analista' : 'colaborador', isInternalNote, body);

  if (user.role === 'analyst' && !isInternalNote) {
    // Encerrar exige motivo — não é permitido mudar para "encerrado" por aqui.
    if (newStatus && newStatus !== STATUS.ENCERRADO) updateObject_(sheet, ticket._row, { Status: newStatus });
    notifyEmail_(ticket, 'respondido');
  }
  return getTicketDetail(ticketId);
}

/** Muda o status sem exigir uma mensagem — para "encerrado" é obrigatório
 * passar por closeTicket() (motivo estruturado + notificação). */
function changeStatus(ticketId, status) {
  var user = getCurrentUser();
  requireAnalyst_(user);
  if (status === STATUS.ENCERRADO) throw new Error('Para encerrar é necessário informar o motivo — use o painel "Encerrar chamado".');
  var sheet = sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  var ticket = findRowById_(sheet, 'ID', ticketId);
  if (!ticket) throw new Error('Chamado não encontrado.');
  updateObject_(sheet, ticket._row, { Status: status });
  addHistoryEntry_(ticketId, user.name, 'analista', true, 'Status alterado para ' + status);
  return getTicketDetail(ticketId);
}

function changePriority(ticketId, priority) {
  var user = getCurrentUser();
  requireAnalyst_(user);
  var sheet = sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  var ticket = findRowById_(sheet, 'ID', ticketId);
  if (!ticket) throw new Error('Chamado não encontrado.');
  var dept = getDepartments().filter(function (d) { return d.name === ticket.Departamento; })[0];
  updateObject_(sheet, ticket._row, {
    Prioridade: priority, PrazoSLA: computeSlaDueAt_(priority, dept ? dept.slaHorasMax : null)
  });
  addHistoryEntry_(ticketId, user.name, 'analista', true, 'Prioridade alterada para ' + priority);
  return getTicketDetail(ticketId);
}

/** Assumir é só um caso particular de transferir: vira responsável = eu mesmo. */
function assumeTicket(ticketId) {
  var user = getCurrentUser();
  requireAnalyst_(user);
  return transferTicket(ticketId, user.email, null, 'Assumido pelo analista');
}

/** Status segue quem ficou responsável: sem ninguém, o chamado está na
 * caixa de entrada geral (em_triagem); com analista definido, em
 * atendimento. Uma vez vinculado a alguém, não volta mais para a caixa de
 * entrada — só dá para transferir para outro analista (nunca "soltar"). */
function transferTicket(ticketId, assignedToEmail, department, reason) {
  var user = getCurrentUser();
  requireAnalyst_(user);
  var sheet = sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  var ticket = findRowById_(sheet, 'ID', ticketId);
  if (!ticket) throw new Error('Chamado não encontrado.');
  if (ticket.AnalistaResponsavel && !assignedToEmail) {
    throw new Error('Este chamado já está vinculado a um analista — transfira para outro analista em vez de devolver à caixa de entrada.');
  }

  var previousAssignee = ticket.AnalistaResponsavel;
  var previousDept = ticket.Departamento;
  var updates = { AnalistaResponsavel: assignedToEmail || '' };
  updates.Status = assignedToEmail ? STATUS.EM_ATENDIMENTO : STATUS.EM_TRIAGEM;
  if (department && department !== previousDept) {
    updates.Departamento = department;
    var dept = getDepartments().filter(function (d) { return d.name === department; })[0];
    updates.PrazoSLA = computeSlaDueAt_(ticket.Prioridade, dept ? dept.slaHorasMax : null);
  }
  updateObject_(sheet, ticket._row, updates);

  var changeMsg = (previousAssignee ? 'Transferido de ' + previousAssignee : 'Atribuído') +
    (assignedToEmail ? ' para ' + assignedToEmail : ' — removido o responsável') +
    (updates.Departamento ? '. Fila alterada para ' + updates.Departamento : '') +
    (reason ? '. Motivo: ' + reason : '.');
  addHistoryEntry_(ticketId, 'Sistema', 'analista', true, changeMsg);
  return getTicketDetail(ticketId);
}

function closeTicket(ticketId, reason, message) {
  var user = getCurrentUser();
  var sheet = sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  var ticket = findRowById_(sheet, 'ID', ticketId);
  if (!ticket) throw new Error('Chamado não encontrado.');
  if (ticket.Status === STATUS.ENCERRADO) throw new Error('Este chamado já está encerrado.');

  var reasonInfo = MOTIVOS_ENCERRAMENTO[reason];
  if (!reasonInfo) throw new Error('Motivo de encerramento inválido.');
  var isOwner = ticket.SolicitanteEmail === user.email;
  var isEmployeeReason = reason === 'resolvido_pelo_colaborador' || reason === 'cancelado_pelo_colaborador';
  if (isEmployeeReason && !isOwner) throw new Error('Só o solicitante pode usar este motivo.');
  if (!isEmployeeReason && user.role !== 'analyst') throw new Error('Sem permissão para usar este motivo.');

  var body = (message && message.trim()) || reasonInfo.message;
  addHistoryEntry_(ticketId, user.name, isOwner ? 'colaborador' : 'analista', false, body);
  updateObject_(sheet, ticket._row, {
    Status: STATUS.ENCERRADO, DataFechamento: new Date(), MotivoFechamento: reasonInfo.label
  });
  notifyEmail_(ticket, 'finalizado');
  return getTicketDetail(ticketId);
}

function getClosureReasons(ticketId) {
  var user = getCurrentUser();
  var sheet = sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  var ticket = findRowById_(sheet, 'ID', ticketId);
  var isOwner = ticket && ticket.SolicitanteEmail === user.email;
  return Object.keys(MOTIVOS_ENCERRAMENTO)
    .filter(function (key) {
      var isEmployeeReason = key === 'resolvido_pelo_colaborador' || key === 'cancelado_pelo_colaborador';
      return isEmployeeReason ? isOwner : user.role === 'analyst';
    })
    .map(function (key) { return { value: key, label: MOTIVOS_ENCERRAMENTO[key].label, defaultMessage: MOTIVOS_ENCERRAMENTO[key].message }; });
}

/* ============================================================
   Anexos (Google Drive)
   ============================================================ */

/** Guarda o ID da pasta em Script Properties em vez de buscar por nome — sob
 * o escopo restrito `drive.file`, buscar por nome em todo o Drive não é
 * confiável; pegar pelo ID de uma pasta que o próprio script criou sempre
 * funciona. */
function getOrCreateAttachmentsFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('attachmentsFolderId');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) { /* pasta foi excluída — recria abaixo */ }
  }
  var folder = DriveApp.createFolder('BEEP Service Desk - Anexos');
  props.setProperty('attachmentsFolderId', folder.getId());
  return folder;
}

/** `base64Data` vem do FileReader do navegador (sem o prefixo data:...;base64,).
 * Devolve o chamado inteiro (igual addComment/transferTicket/etc.), não só
 * a lista de anexos — o cliente usa isso pra atualizar a tela sem precisar
 * de uma segunda chamada a getTicketDetail() só pra re-renderizar. */
function uploadAttachment(ticketId, filename, mimeType, base64Data) {
  var user = getCurrentUser();
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, filename);
  var file = getOrCreateAttachmentsFolder_().createFile(blob);
  appendObject_(sheet_(SHEETS.ANEXOS, HEADERS.Anexos), {
    ID: Utilities.getUuid(), ChamadoID: ticketId, NomeArquivo: filename,
    URL: file.getUrl(), EnviadoPor: user.email, DataHora: new Date()
  });
  return getTicketDetail(ticketId);
}

function listAttachments(ticketId) {
  return rowsAsObjects_(sheet_(SHEETS.ANEXOS, HEADERS.Anexos))
    .filter(function (a) { return a.ChamadoID === ticketId; })
    .map(function (a) { return { name: a.NomeArquivo, url: a.URL }; });
}

/* ============================================================
   Passo a passo ilustrado
   ============================================================ */

/** Aceita tanto o ID puro quanto qualquer link do Drive colado pelo time
 * (`/file/d/ID/view`, `open?id=ID`, ...) — o DP cola o link como veio, sem
 * precisar saber o que é "ID de arquivo". */
function extractDriveId_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  var match = text.match(/[-\w]{25,}/);
  return match ? match[0] : '';
}

/** Etapas de um FAQ, em ordem. Devolve só os metadados — a imagem em si é
 * buscada depois, uma a uma (ver getStepImage), para o texto do passo a
 * passo aparecer na hora e as telas irem preenchendo em seguida. */
function getStepsFor(faqQuestion) {
  var alvo = String(faqQuestion || '').trim().toLowerCase();
  if (!alvo) return [];
  return rowsAsObjects_(sheet_(SHEETS.PASSOS, HEADERS.Passos))
    .filter(function (p) { return String(p.Pergunta).trim().toLowerCase() === alvo; })
    .sort(function (a, b) { return Number(a.Ordem || 0) - Number(b.Ordem || 0); })
    .map(function (p) {
      return {
        order: Number(p.Ordem || 0), title: String(p.Titulo || ''),
        text: String(p.Texto || ''), imageId: extractDriveId_(p.Imagem)
      };
    });
}

/**
 * Entrega a imagem como data URI. Busca pelo link público do Drive (o
 * arquivo precisa estar compartilhado como "qualquer pessoa com o link"),
 * em vez de ler via DriveApp — isso evita depender de um escopo de leitura
 * geral do Drive (que só o dono da implantação pode autorizar). O link
 * não é exposto ao navegador do colaborador: o próprio script busca o
 * conteúdo e entrega como data URI embutido na resposta.
 * Falha nunca quebra a resposta — a etapa simplesmente aparece sem a tela.
 */
function getStepImage(fileId) {
  var id = extractDriveId_(fileId);
  if (!id) return '';
  try {
    var res = UrlFetchApp.fetch('https://drive.google.com/uc?export=view&id=' + id, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('Não consegui buscar a imagem do passo a passo (' + id + '): HTTP ' + res.getResponseCode());
      return '';
    }
    var blob = res.getBlob();
    var type = blob.getContentType() || 'image/png';
    if (type.indexOf('image/') !== 0) return '';
    return 'data:' + type + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    Logger.log('Não consegui buscar a imagem do passo a passo (' + id + '): ' + e);
    return '';
  }
}

/* ============================================================
   Respostas padrão
   ============================================================ */

function listCannedResponses(department) {
  return rowsAsObjects_(sheet_(SHEETS.RESPOSTAS_PADRAO, HEADERS.RespostasPadrao))
    .filter(function (r) { return !r.Departamento || r.Departamento === department; })
    .map(function (r) { return { id: r.ID, title: r.Titulo, content: r.Conteudo, department: r.Departamento || null }; });
}

function createCannedResponse(title, content, department) {
  requireAnalyst_(getCurrentUser());
  appendObject_(sheet_(SHEETS.RESPOSTAS_PADRAO, HEADERS.RespostasPadrao), {
    ID: Utilities.getUuid(), Titulo: title, Conteudo: content, Departamento: department || ''
  });
  return listCannedResponses(department);
}

function deleteCannedResponse(id, department) {
  requireAnalyst_(getCurrentUser());
  var sheet = sheet_(SHEETS.RESPOSTAS_PADRAO, HEADERS.RespostasPadrao);
  var row = findRowById_(sheet, 'ID', id);
  if (row) sheet.deleteRow(row._row);
  return listCannedResponses(department);
}

/* ============================================================
   Dashboard (bem simples — só o essencial)
   ============================================================ */

function getDashboardStats() {
  requireAnalyst_(getCurrentUser());
  var tickets = rowsAsObjects_(sheet_(SHEETS.CHAMADOS, HEADERS.Chamados));
  var abertos = tickets.filter(function (t) { return t.Status !== STATUS.RESOLVIDO && t.Status !== STATUS.ENCERRADO; });
  var overdue = abertos.filter(function (t) { return t.PrazoSLA && new Date(t.PrazoSLA) < new Date(); });
  // "Atrasados" é um recorte DENTRO de "Em aberto" (um chamado atrasado
  // também está aberto), não uma quarta categoria — por isso não soma com
  // Total/Aberto/Finalizados. Quem quiser esse detalhe olha
  // abertosPorStatus, que sim é mutuamente exclusivo e fecha com abertos.
  var abertosPorStatus = {};
  abertos.forEach(function (t) { abertosPorStatus[t.Status] = (abertosPorStatus[t.Status] || 0) + 1; });
  var porDepartamento = {};
  tickets.forEach(function (t) { porDepartamento[t.Departamento] = (porDepartamento[t.Departamento] || 0) + 1; });

  var abertosPorCategoria = {};
  abertos.forEach(function (t) { abertosPorCategoria[t.Departamento] = (abertosPorCategoria[t.Departamento] || 0) + 1; });

  // Tempo (corrido, não em horas úteis) da abertura até a PRIMEIRA resposta
  // pública do analista, por fila — é isso que aponta categoria lenta x
  // rápida pra responder. Chamado sem resposta ainda não entra na média.
  var historico = rowsAsObjects_(sheet_(SHEETS.HISTORICO, HEADERS.Historico));
  var primeiraRespostaPorChamado = {};
  historico
    .filter(function (h) { return h.Papel === 'analista' && !h.Interno; })
    .forEach(function (h) {
      var atual = primeiraRespostaPorChamado[h.ChamadoID];
      if (!atual || new Date(h.DataHora) < new Date(atual)) primeiraRespostaPorChamado[h.ChamadoID] = h.DataHora;
    });
  var somaHoras = {}, contagem = {};
  tickets.forEach(function (t) {
    var primeira = primeiraRespostaPorChamado[t.ID];
    if (!primeira) return;
    var horas = (new Date(primeira) - new Date(t.DataAbertura)) / 3600000;
    if (horas < 0) return;
    somaHoras[t.Departamento] = (somaHoras[t.Departamento] || 0) + horas;
    contagem[t.Departamento] = (contagem[t.Departamento] || 0) + 1;
  });
  var tempoMedioPorCategoria = {};
  Object.keys(contagem).forEach(function (dep) { tempoMedioPorCategoria[dep] = somaHoras[dep] / contagem[dep]; });

  // "Resolvido pela IA" = toda resposta automática dada (InteracoesIA),
  // sem depender de confirmação do colaborador — ver logAiInteraction_ em
  // AiService.gs. "Resolvido por analista" = chamados que chegaram a
  // resolvido/encerrado.
  var iaResolvidos = Math.max(0, sheet_(SHEETS.INTERACOES_IA, HEADERS.InteracoesIA).getLastRow() - 1);
  var analistaResolvidos = tickets.filter(function (t) { return t.Status === STATUS.RESOLVIDO || t.Status === STATUS.ENCERRADO; }).length;

  return {
    total: tickets.length, abertos: abertos.length, finalizados: tickets.length - abertos.length,
    atrasados: overdue.length, abertosPorStatus: abertosPorStatus,
    porDepartamento: porDepartamento,
    abertosPorCategoria: abertosPorCategoria,
    tempoMedioPorCategoria: tempoMedioPorCategoria,
    iaResolvidos: iaResolvidos,
    analistaResolvidos: analistaResolvidos
  };
}
