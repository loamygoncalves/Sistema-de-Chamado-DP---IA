/**
 * Notificações por e-mail (aberto/respondido/finalizado) via MailApp — no
 * sistema real isso é uma task assíncrona via SMTP; aqui é síncrono (Apps
 * Script não tem fila em background), mas o efeito para quem recebe é o
 * mesmo. Uma falha de envio (cota diária de e-mail estourada, por exemplo)
 * nunca deve travar o fluxo do chamado — por isso o try/catch.
 *
 * Remetente: por padrão os e-mails saem da conta que fez o deploy (é como
 * o MailApp funciona — não dá para simplesmente "inventar" um remetente).
 * Para sair como "dp@beepsaude.com.br", configure em Script Properties
 * `EMAIL_FROM` = dp@beepsaude.com.br — mas ANTES disso, essa conta precisa
 * estar cadastrada como "Enviar e-mail como" (send-as alias verificado) nas
 * configurações do Gmail da conta que fez o deploy (Configurações > Contas
 * e importação > "Enviar e-mail como" > Adicionar outro endereço de
 * e-mail). Sem isso verificado, o envio falha (e cai no catch abaixo, sem
 * travar o chamado, mas também sem avisar ninguém).
 */

function emailFrom_() {
  return PropertiesService.getScriptProperties().getProperty('EMAIL_FROM') || '';
}

function notifyEmail_(ticket, event) {
  var enabled = PropertiesService.getScriptProperties().getProperty('EMAIL_NOTIFICATIONS_ENABLED');
  if (enabled === 'false') return;
  if (!ticket.SolicitanteEmail) return;

  var subjects = {
    aberto: 'Chamado ' + ticket.Protocolo + ' aberto',
    respondido: 'Chamado ' + ticket.Protocolo + ' respondido',
    finalizado: 'Chamado ' + ticket.Protocolo + ' finalizado'
  };
  var textos = {
    aberto: {
      etiqueta: 'Chamado aberto', titulo: 'Recebemos sua solicitação!',
      corpo: 'Seu chamado entrou na fila de atendimento do time de DP e em breve alguém vai te responder.',
      caixa: ticket.PrazoSLA ? { rotulo: 'Prazo de resposta', valor: Utilities.formatDate(new Date(ticket.PrazoSLA), Session.getScriptTimeZone(), 'dd/MM/yyyy \'às\' HH:mm') } : null
    },
    respondido: {
      etiqueta: 'Nova resposta', titulo: 'Seu chamado foi respondido',
      corpo: 'Um analista do DP respondeu ao seu chamado. Acesse o sistema para ver a mensagem completa e continuar a conversa, se precisar.',
      caixa: null
    },
    finalizado: {
      etiqueta: 'Chamado finalizado', titulo: 'Seu chamado foi encerrado',
      corpo: 'Seu chamado foi finalizado pelo time de DP.',
      caixa: ticket.MotivoFechamento ? { rotulo: 'Motivo do encerramento', valor: ticket.MotivoFechamento } : null
    }
  };

  var opcoes = {
    to: ticket.SolicitanteEmail,
    subject: subjects[event],
    htmlBody: emailHtml_(textos[event], ticket),
    body: 'Chamado ' + ticket.Protocolo + ' — ' + ticket.Assunto + '\n\n' + textos[event].corpo
  };
  if (emailFrom_()) {
    opcoes.from = emailFrom_();
    opcoes.name = 'BEEP · Central de Atendimento DP';
  }

  try {
    MailApp.sendEmail(opcoes);
  } catch (e) {
    Logger.log('Falha ao enviar e-mail de notificação (' + event + '): ' + e);
  }
}

/** Template HTML do e-mail — cores da marca Beep (teal + laranja), layout
 * em tabelas (mais compatível entre clientes de e-mail que flex/grid). */
function emailHtml_(texto, ticket) {
  var caixaHtml = texto.caixa ? (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0; background:#F4F4F4; border-radius:8px;">' +
    '<tr><td style="padding:16px 20px;">' +
    '<div style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#4F5E69; opacity:.7;">' + escapeHtml_(texto.caixa.rotulo) + '</div>' +
    '<div style="font-size:16px; font-weight:700; color:#00AFAA; margin-top:4px;">' + escapeHtml_(texto.caixa.valor) + '</div>' +
    '</td></tr></table>'
  ) : '';

  return '' +
    '<div style="background:#F4F4F4; padding:32px 16px; font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#FFFFFF; border-radius:10px; overflow:hidden;">' +
    '<tr><td style="background:#00AFAA; padding:20px 28px;">' +
    '<span style="color:#FFFFFF; font-size:18px; font-weight:700;">beep!</span>' +
    '<span style="color:#FFFFFF; font-size:13px; font-weight:600; opacity:.85; margin-left:8px;">| CENTRAL DE ATENDIMENTO DP</span>' +
    '</td></tr>' +
    '<tr><td style="background:#FBA600; height:4px; line-height:4px; font-size:0;">&nbsp;</td></tr>' +
    '<tr><td style="padding:28px;">' +
    '<div style="font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#00AFAA;">' + escapeHtml_(texto.etiqueta) + '</div>' +
    '<h1 style="font-size:20px; color:#4F5E69; margin:6px 0 16px;">' + escapeHtml_(texto.titulo) + '</h1>' +
    '<p style="font-size:14px; line-height:1.55; color:#4F5E69; margin:0;">' +
    'Olá, <b>' + escapeHtml_(ticket.SolicitanteNome) + '</b> — chamado <b>' + escapeHtml_(ticket.Protocolo) + '</b> (' + escapeHtml_(ticket.Assunto) + ').' +
    '</p>' +
    '<p style="font-size:14px; line-height:1.55; color:#4F5E69; margin:14px 0 0;">' + escapeHtml_(texto.corpo) + '</p>' +
    caixaHtml +
    '</td></tr>' +
    '<tr><td style="padding:16px 28px; border-top:1px solid #E5E5E5;">' +
    '<span style="font-size:11px; color:#4F5E69; opacity:.6;">Este e-mail foi enviado automaticamente pelo BEEP Service Desk.</span>' +
    '</td></tr>' +
    '</table></div>';
}

function escapeHtml_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
