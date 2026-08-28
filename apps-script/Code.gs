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
  ANEXOS: 'Anexos'
};

var HEADERS = {
  Departamentos: ['Nome', 'PrioridadePadrao', 'SlaHorasMax'],
  Analistas: ['Nome', 'Email', 'Ativo'],
  // Diretório oficial vindo da ADP (só colaboradores ativos — reimportar por
  // cima a cada atualização já revoga quem foi desligado, sem precisar de
  // coluna de status). Usado pra reconhecer o colaborador pelo e-mail da
  // conta Google, e como validação de matrícula pra quem não tem e-mail
  // Google cadastrado.
  Colaboradores: ['Matricula', 'Nome', 'Email', 'Filial', 'DataAdmissao', 'Celular'],
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
  Anexos: ['ID', 'ChamadoID', 'NomeArquivo', 'URL', 'EnviadoPor', 'DataHora']
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
  var ehAnalista = rowsAsObjects_(sheet_(SHEETS.ANALISTAS, HEADERS.Analistas)).some(function (a) {
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

/** Papel do usuário logado é decidido pela aba "Analistas": se o e-mail da
 * conta Google atual estiver lá (e Ativo=TRUE), ele é analista.
 *
 * Senão, é colaborador — e como nem todo colaborador tem e-mail de domínio
 * (a implantação aceita qualquer conta Google, não só @beepsaude), a
 * identidade dele é conferida contra a aba "Colaboradores" (importada da
 * ADP, só gente ativa): primeiro pelo e-mail da conta logada, e se não
 * bater, pela matrícula que ele já confirmou antes (ver verifyMatricula).
 * Sem bater nenhum dos dois, `verified` vem `false` e o cliente mostra a
 * tela pedindo a matrícula — é essa checagem que também tira o acesso de
 * quem foi desligado: a próxima vez que a aba Colaboradores for atualizada
 * (reimportação substitui tudo), a matrícula/e-mail dessa pessoa somem de
 * lá e nem o e-mail nem a matrícula salva batem mais. */
function getCurrentUser() {
  var email = (Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').trim();
  var analistas = rowsAsObjects_(sheet_(SHEETS.ANALISTAS, HEADERS.Analistas));
  var analyst = analistas.filter(function (a) {
    return String(a.Email).trim().toLowerCase() === email.toLowerCase() && a.Ativo;
  })[0];
  if (analyst) {
    return { email: email, name: analyst.Nome, role: 'analyst', verified: true, matricula: '', filial: '', dataAdmissao: '' };
  }

  var colaboradores = rowsAsObjects_(sheet_(SHEETS.COLABORADORES, HEADERS.Colaboradores));
  var porEmail = email ? colaboradores.filter(function (c) {
    return String(c.Email).trim().toLowerCase() === email.toLowerCase();
  })[0] : null;
  var matriculaSalva = getMyProfile_().matricula;
  var porMatricula = !porEmail && matriculaSalva ? colaboradores.filter(function (c) {
    return String(c.Matricula).trim() === String(matriculaSalva).trim();
  })[0] : null;
  var colaborador = porEmail || porMatricula;

  return {
    email: email,
    name: colaborador ? colaborador.Nome : (getMyProfile_().name || (email ? email.split('@')[0] : 'Colaborador')),
    role: 'employee',
    verified: !!colaborador,
    matricula: colaborador ? colaborador.Matricula : (matriculaSalva || ''),
    filial: colaborador ? colaborador.Filial : '',
    dataAdmissao: colaborador ? toIso_(colaborador.DataAdmissao) : ''
  };
}

function requireAnalyst_(user) {
  if (user.role !== 'analyst') throw new Error('Ação restrita a analistas.');
}

/** Confere a matrícula digitada contra a aba Colaboradores (importada da
 * ADP). Usada por quem não tem e-mail de conta Google cadastrado — depois
 * de confirmada uma vez, fica salva por conta Google (UserProperties) e
 * getCurrentUser() volta a reconhecer sozinho nas próximas visitas. */
function verifyMatricula(matricula) {
  var mat = String(matricula || '').trim();
  if (!mat) throw new Error('Informe sua matrícula.');
  var colaborador = rowsAsObjects_(sheet_(SHEETS.COLABORADORES, HEADERS.Colaboradores))
    .filter(function (c) { return String(c.Matricula).trim() === mat; })[0];
  if (!colaborador) throw new Error('Matrícula não encontrada. Confira o número ou fale com o time de DP.');
  saveMyProfile_(colaborador.Nome, colaborador.Matricula);
  return getCurrentUser();
}

/** Nome/matrícula ficam salvos por conta Google (UserProperties) — depois de
 * confirmados uma vez (por bater com a aba Colaboradores, ou digitados na
 * abertura de chamado), pré-preenchem as próximas visitas. */
function getMyProfile_() {
  var props = PropertiesService.getUserProperties();
  return { name: props.getProperty('nome') || '', matricula: props.getProperty('matricula') || '' };
}

function getMyProfile() {
  var profile = getMyProfile_();
  var user = getCurrentUser();
  return { name: profile.name || user.name, matricula: profile.matricula, email: user.email };
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
  return rowsAsObjects_(sheet_(SHEETS.ANALISTAS, HEADERS.Analistas))
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
function computeSlaDueAt_(priority, slaHorasMax) {
  var hours = SLA_HORAS_POR_PRIORIDADE[priority] || 48;
  if (slaHorasMax) hours = Math.min(hours, Number(slaHorasMax));
  var date = new Date();
  var remaining = hours;
  while (remaining > 0) {
    date = new Date(date.getTime() + 60 * 60 * 1000);
    var day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
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

function serializeTicket_(t) {
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
    assignedTo: t.AnalistaResponsavel || null,
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
    attachments: listAttachments(ticketId)
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
    if (filters.unassigned) tickets = tickets.filter(function (t) { return !t.AnalistaResponsavel; });
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
  return tickets.map(serializeTicket_);
}

function addComment(ticketId, body, isInternal, newStatus) {
  var user = getCurrentUser();
  var sheet = sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  var ticket = findRowById_(sheet, 'ID', ticketId);
  if (!ticket) throw new Error('Chamado não encontrado.');
  var isOwner = ticket.SolicitanteEmail === user.email;
  if (!isOwner && user.role !== 'analyst') throw new Error('Sem permissão.');

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

/** Status segue quem ficou responsável: com analista definido, o chamado
 * está sendo atendido; sem ninguém (voltou pra caixa de entrada), volta
 * para triagem — mesma regra automática do sistema real. */
function transferTicket(ticketId, assignedToEmail, department, reason) {
  var user = getCurrentUser();
  requireAnalyst_(user);
  var sheet = sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  var ticket = findRowById_(sheet, 'ID', ticketId);
  if (!ticket) throw new Error('Chamado não encontrado.');

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

/** `base64Data` vem do FileReader do navegador (sem o prefixo data:...;base64,). */
function uploadAttachment(ticketId, filename, mimeType, base64Data) {
  var user = getCurrentUser();
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, filename);
  var file = getOrCreateAttachmentsFolder_().createFile(blob);
  appendObject_(sheet_(SHEETS.ANEXOS, HEADERS.Anexos), {
    ID: Utilities.getUuid(), ChamadoID: ticketId, NomeArquivo: filename,
    URL: file.getUrl(), EnviadoPor: user.email, DataHora: new Date()
  });
  return listAttachments(ticketId);
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
  var porDepartamento = {};
  tickets.forEach(function (t) { porDepartamento[t.Departamento] = (porDepartamento[t.Departamento] || 0) + 1; });
  return { total: tickets.length, abertos: abertos.length, atrasados: overdue.length, porDepartamento: porDepartamento };
}
