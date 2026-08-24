/**
 * Menu da planilha + inicialização das abas com dados de exemplo. Rode
 * "Inicializar planilhas" uma vez (pelo menu ou pelo editor de script) antes
 * do primeiro uso — ver README.md.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BEEP Service Desk')
    .addItem('Inicializar planilhas (1x)', 'initializeSpreadsheet')
    .addToUi();
}

function initializeSpreadsheet() {
  var departamentos = sheet_(SHEETS.DEPARTAMENTOS, HEADERS.Departamentos);
  if (departamentos.getLastRow() < 2) {
    SEED_DEPARTMENTS_.forEach(function (d) {
      appendObject_(departamentos, { Nome: d[0], PrioridadePadrao: d[1], SlaHorasMax: '' });
    });
  }

  var faqs = sheet_(SHEETS.FAQS, HEADERS.FAQs);
  if (faqs.getLastRow() < 2) {
    SEED_FAQS_.forEach(function (f) {
      appendObject_(faqs, { Pergunta: f.q, Resposta: f.a, Departamento: f.dept });
    });
  }

  var analistas = sheet_(SHEETS.ANALISTAS, HEADERS.Analistas);
  if (analistas.getLastRow() < 2) {
    appendObject_(analistas, { Nome: 'Substitua-me', Email: 'analista@suaempresa.com.br', Ativo: true });
  }

  var respostas = sheet_(SHEETS.RESPOSTAS_PADRAO, HEADERS.RespostasPadrao);
  if (respostas.getLastRow() < 2) {
    appendObject_(respostas, {
      ID: Utilities.getUuid(), Titulo: 'Prazo de resposta padrão', Departamento: '',
      Conteudo: 'Obrigado pelo contato! Já estamos analisando o seu caso e retornamos dentro do prazo de SLA informado no chamado.'
    });
  }

  // Só garante que as abas existem — sem dado de exemplo (nascem vazias).
  sheet_(SHEETS.CHAMADOS, HEADERS.Chamados);
  sheet_(SHEETS.HISTORICO, HEADERS.Historico);
  sheet_(SHEETS.ANEXOS, HEADERS.Anexos);

  SpreadsheetApp.getUi().alert(
    'Planilhas prontas!\n\n' +
    'Antes de divulgar o link do sistema:\n' +
    '1) Edite a aba "Analistas" com os e-mails reais do time de DP.\n' +
    '2) (Opcional) Em Configurações do projeto > Propriedades do script, defina ANTHROPIC_API_KEY ' +
    'para respostas mais naturais e resumos de chamado com IA de verdade.\n' +
    '3) Publique como app da Web (Implantar > Nova implantação).'
  );
}

var SEED_DEPARTMENTS_ = [
  ['Folha de pagamento', 'critica'],
  ['Férias', 'media'],
  ['Vale Refeição', 'media'],
  ['Plano de saúde', 'alta'],
  ['Vale transporte', 'media'],
  ['Banco de horas', 'media'],
  ['Admissão', 'alta'],
  ['Rescisão', 'alta'],
  ['Plano Odontológico', 'media'],
  ['Seguro de Vida', 'media'],
  ['TotalPass', 'baixa'],
  ['Gympass', 'baixa'],
  ['Auxilio Creche', 'media'],
  ['Declarações', 'baixa'],
  ['Empréstimo Consignado', 'media'],
  ['Atualização Cadastral', 'baixa'],
  ['Telemedicina Conexa', 'alta'],
  ['Ponto', 'baixa']
];

var SEED_FAQS_ = [
  { q: 'Quando e onde recebo meu salário?', a: 'O pagamento ocorre no 5º dia útil de cada mês (o sábado conta como dia útil), exclusivamente nas contas Bradesco ou Next (conta salário ou conta corrente). Para abrir a conta salário online, use o Código de Convênio 180801805 e o CNPJ 28.286.170/0001-01. Para receber em outro banco, solicite a portabilidade salarial diretamente na instituição financeira de sua preferência.', dept: 'Folha de pagamento' },
  { q: 'Como funciona o pagamento do 13º salário?', a: 'O 13º é pago em duas parcelas: a primeira até 30/11, correspondente a 50% do valor total e sem descontos; a segunda até 20/12, já com desconto de INSS e Imposto de Renda.', dept: 'Folha de pagamento' },
  { q: 'Como solicitar férias e o que reduz a quantidade de dias?', a: 'Os gestores devem solicitar até o dia 10 do mês anterior ao mês de gozo, e o depósito ocorre até 2 dias antes do início do período aprovado. Atenção: faltas injustificadas no período aquisitivo de 12 meses reduzem os dias de férias (Art. 130 da CLT) — até 5 faltas mantém os 30 dias corridos; de 6 a 14 faltas reduz para 24 dias; de 15 a 23 faltas para 18 dias; de 24 a 32 faltas para 12 dias; acima de 32 faltas há perda do direito às férias no período.', dept: 'Férias' },
  { q: 'Como funciona o Vale Refeição/Alimentação?', a: 'No mês da admissão (provisório), o valor é depositado no cartão entregue no onboarding em até 72h úteis, com desconto de 1 dia de trabalho — se a admissão ocorrer após o dia 15, o depósito já contempla o mês seguinte também (ex.: admissão em 17/01 cobre de 17/01 a 28/02). Depois da admissão (definitivo), o valor é creditado todo dia 25 no cartão definitivo entregue no Hub, para uso no mês seguinte, também com desconto de 1 dia de trabalho. Solicitações e atualizações de benefícios devem ser feitas até o dia 15 de cada mês.', dept: 'Vale Refeição' },
  { q: 'Como funciona o Vale Transporte?', a: 'No mês da admissão (provisório), o valor é depositado via Pix ou na conta Bradesco/Next aberta na admissão, em até 72h úteis, com desconto de 6% do salário base. Depois da admissão (definitivo), é creditado no cartão da operadora até o último dia do mês, com o mesmo desconto de 6% do salário base — é necessário ter o cartão em mãos.', dept: 'Vale transporte' },
  { q: 'Como funcionam os benefícios extras de VT e VR/VA?', a: 'Vale-Transporte e Refeição/Alimentação extras, referentes a dias trabalhados além da escala habitual, são calculados com base nesses dias e disponibilizados no dia 20 do mês seguinte.', dept: 'Vale Refeição' },
  { q: 'Como funciona o Plano de Saúde (Bradesco Saúde)?', a: 'O titular não paga mensalidade, apenas 30% de coparticipação em consultas e exames simples, e 30% em pronto atendimento (limitado a R$ 150,00). Dependentes legais (filhos e cônjuge) pagam mensalidade conforme tabela, com a mesma coparticipação. Ativação do titular: BackOffice até o dia 10 do mês seguinte à admissão, Time Operacional em 3 meses; dependente em até 30 dias da admissão, nascimento ou casamento. Acesso pelo app do plano no primeiro acesso, com os dados pessoais. O repasse de coparticipação pode levar até 3 meses do procedimento.', dept: 'Plano de saúde' },
  { q: 'Quais serviços adicionais o Plano de Saúde oferece?', a: 'Meu Doutor Bradesco Saúde dá acesso facilitado a profissionais selecionados; a Novamed é uma rede de clínicas integrada, sem coparticipação e com telemedicina em algumas unidades; a Saúde Digital é telemedicina por vídeo disponível 24h; e o Clube + Saúde oferece descontos em lojas e estabelecimentos parceiros. Atendimento: capitais e regiões metropolitanas 4004-2700; demais localidades 0800 701 2700.', dept: 'Plano de saúde' },
  { q: 'Como incluir dependente no plano de saúde?', a: 'A solicitação deve ser feita em até 30 dias da admissão, do nascimento ou do casamento, enviando os documentos do dependente pelo portal de chamados, categoria Plano de saúde.', dept: 'Plano de saúde' },
  { q: 'Como funciona o Plano Odontológico?', a: 'O titular não paga mensalidade nem coparticipação. Dependentes legais pagam mensalidade de R$ 12,12, sem coparticipação. Mesmos prazos de ativação do plano de saúde. Convênio Bradesco Seguros, acesso pelo app no primeiro acesso.', dept: 'Plano Odontológico' },
  { q: 'Como funciona a Conexa Saúde (Telemedicina)?', a: 'O titular não paga mensalidade nem coparticipação; dependentes legais pagam R$ 12,12, sem coparticipação. Ativação do titular segue a área de atuação (BackOffice até o dia 10 do mês seguinte à admissão, operacional em 3 meses); a do dependente depende da ativação do Plano de Saúde. Acesso pelo app no primeiro acesso.', dept: 'Telemedicina Conexa' },
  { q: 'O que cobre o Seguro de Vida MetLife?', a: 'É sem custo para o colaborador. Inclui assistência funeral para titular e dependentes legais, coroa de flores para pais, cônjuge e filhos, e cartão natalidade em caso de nascimento de filho(a).', dept: 'Seguro de Vida' },
  { q: 'Como funciona o TotalPass?', a: 'A mensalidade do titular e dos dependentes legais segue o plano escolhido na plataforma, sem coparticipação. Ativação até o dia 10 do mês seguinte à admissão; a do dependente ocorre após a ativação do titular. Acesso pelo app, informando e-mail pessoal e a empresa Beep Saúde no primeiro acesso.', dept: 'TotalPass' },
  { q: 'Como funciona o Wellhub (antigo Gympass)?', a: 'Assim como o TotalPass, a mensalidade segue o plano escolhido na plataforma, sem coparticipação para titular ou dependentes. Ativação até o dia 10 do mês seguinte à admissão, com acesso pelo app usando e-mail pessoal e informando a empresa Beep Saúde.', dept: 'Gympass' },
  { q: 'Tenho desconto em vacinas e exames?', a: 'Sim — você e sua família (cônjuge e filhos) têm 10% de desconto em vacinas e 20% em exames. Preencha o formulário do time Comercial em app.pipefy.com/public/form/cY3fhrUL para gerar o cupom de desconto.', dept: 'Declarações' },
  { q: 'Quem tem direito ao Auxílio Creche e como solicitar?', a: 'Têm direito mães com filho de até 6 anos (no mês do aniversário) e pais com filho de até 6 anos com guarda judicial total da criança. O valor mensal é de R$ 324,20 no Rio de Janeiro e R$ 361,31 em São Paulo. Envie recibo de papelaria assinado com valor, ou boleto da creche com comprovante de pagamento, até o dia 20 de cada mês, por chamado na plataforma TomTicket (beep.tomticket.com/helpdesk).', dept: 'Auxilio Creche' },
  { q: 'Como solicitar pensão alimentícia (ofício de pensão)?', a: 'Envie o ofício de pensão com os dados bancários do recebedor por chamado na plataforma TomTicket (beep.tomticket.com/helpdesk).', dept: 'Declarações' },
  { q: 'Como funciona o registro de ponto?', a: 'O ponto é biométrico (impressão digital), registrado em qualquer Hub, com marcação apenas de entrada e saída e tolerância de 10 minutos. Divergências são ajustadas no Portal ADP, onde também ficam disponíveis contracheques, informe de rendimentos, benefícios cadastrados, dependentes ativos e ajustes de ponto. O acesso é enviado por e-mail.', dept: 'Ponto' },
  { q: 'Como funciona o banco de horas e as horas extras?', a: 'A janela do banco de horas é semestral: 1ª janela de fevereiro a julho, 2ª de agosto a janeiro — ao encerrar cada janela, os valores finais são pagos ou descontados em folha. Diaristas (6x1 e 5x2): em dias de escala, as 2 primeiras horas excedentes entram para o banco e o restante é hora extra; em dias de folga, tudo vira crédito de banco de horas. Plantonistas (12x36): mesma regra das 2 primeiras horas em dias de escala; em folgas, tudo é hora extra. O fechamento do ponto ocorre no 3º dia útil do mês — depois disso não é possível fazer ajuste nem reembolso retroativo.', dept: 'Banco de horas' },
  { q: 'Quais dados devo manter atualizados e como faço isso?', a: 'Mantenha atualizados: endereço, telefone, e-mail, dados bancários, dependentes, estado civil, registro profissional (COREN, CRF) e CNH válida com EAR. A atualização é feita por chamado na plataforma TomTicket (beep.tomticket.com/helpdesk).', dept: 'Atualização Cadastral' },
  { q: 'Como enviar um atestado médico por ausência no trabalho?', a: 'Abra o chamado pela plataforma Pipefy (app.pipefy.com/public/form/4qqvxrxk) e aguarde o contato do time de Saúde do Trabalho para dar seguimento ao lançamento do documento.', dept: 'Declarações' },
  { q: 'Quais são as ausências legais previstas e seus prazos?', a: 'Atestado ou declaração de horas: abono do período com documento comprobatório. Licença falecimento: 3 dias consecutivos a partir da data registrada no documento, para ascendentes e descendentes (pais, irmãos, filhos, netos, bisnetos, avós, bisavós). Licença casamento: 5 dias em São Paulo ou 3 dias no Rio de Janeiro e Distrito Federal, a partir da data do documento. Acompanhamento médico familiar: 1 dia por ano para levar filho de até 6 anos ao médico, ou até 6 consultas/exames da companheira durante a gravidez (o documento deve ter nome do colaborador e do dependente, data do atendimento, carimbo e assinatura do médico). Licença paternidade: 5 dias corridos a partir da comprovação da paternidade, conforme a CLT.', dept: 'Declarações' },
  { q: 'Qual a política de home office?', a: 'Modelo híbrido: mínimo de 2 dias presenciais por semana, definidos com o gestor direto. Ajuda de custo de internet é creditada junto ao salário.', dept: 'Declarações' }
];
