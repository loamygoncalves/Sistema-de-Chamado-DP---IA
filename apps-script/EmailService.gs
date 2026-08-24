/**
 * Notificações por e-mail (aberto/respondido/finalizado) via MailApp — no
 * sistema real isso é uma task assíncrona via SMTP; aqui é síncrono (Apps
 * Script não tem fila em background), mas o efeito para quem recebe é o
 * mesmo. Uma falha de envio (cota diária de e-mail estourada, por exemplo)
 * nunca deve travar o fluxo do chamado — por isso o try/catch.
 */

function notifyEmail_(ticket, event) {
  var enabled = PropertiesService.getScriptProperties().getProperty('EMAIL_NOTIFICATIONS_ENABLED');
  if (enabled === 'false') return;
  if (!ticket.SolicitanteEmail) return;

  var subjects = {
    aberto: 'Chamado ' + ticket.Protocolo + ' aberto',
    respondido: 'Chamado ' + ticket.Protocolo + ' respondido',
    finalizado: 'Chamado ' + ticket.Protocolo + ' finalizado'
  };
  var bodies = {
    aberto: 'Seu chamado foi aberto e está na fila de atendimento do DP.' +
      (ticket.PrazoSLA ? ' Prazo de resposta: ' + Utilities.formatDate(new Date(ticket.PrazoSLA), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + '.' : ''),
    respondido: 'Você recebeu uma nova resposta no seu chamado. Acesse o sistema para ver a mensagem completa.',
    finalizado: 'Seu chamado foi finalizado.' + (ticket.MotivoFechamento ? ' Motivo: ' + ticket.MotivoFechamento + '.' : '')
  };

  try {
    MailApp.sendEmail({
      to: ticket.SolicitanteEmail,
      subject: subjects[event],
      body: 'Chamado ' + ticket.Protocolo + ' — ' + ticket.Assunto + '\n\n' + bodies[event]
    });
  } catch (e) {
    Logger.log('Falha ao enviar e-mail de notificação (' + event + '): ' + e);
  }
}
