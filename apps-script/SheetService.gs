/**
 * Acesso genérico às planilhas que funcionam como "banco de dados" deste
 * protótipo. Cada aba tem uma linha de cabeçalho; estas funções convertem
 * linhas em objetos JS (chave = nome da coluna) e vice-versa, para o resto
 * do código nunca precisar lidar com índice de coluna.
 */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Devolve a aba `name`, criando-a com o cabeçalho `headers` se não existir.
 * Também corrige uma aba que ficou pela metade (existe, mas sem cabeçalho)
 * por causa de uma inicialização anterior que travou no meio do caminho —
 * sem isso, alguém teria que apagar a aba manualmente para tentar de novo. */
function sheet_(name, headers) {
  var ss = ss_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function headers_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

/** Todas as linhas de dados como objetos {Coluna: valor}, mais `_row` (número
 * da linha na planilha, 1-based) — necessário para updateObject_/deleteRow. */
function rowsAsObjects_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = sheet.getLastColumn();
  var heads = headers_(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var obj = { _row: r + 2 };
    for (var c = 0; c < heads.length; c++) obj[heads[c]] = values[r][c];
    out.push(obj);
  }
  return out;
}

function appendObject_(sheet, obj) {
  var heads = headers_(sheet);
  var row = heads.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/** Atualiza só as chaves presentes em `obj`; o resto da linha fica como estava. */
function updateObject_(sheet, rowIndex, obj) {
  var heads = headers_(sheet);
  var current = sheet.getRange(rowIndex, 1, 1, heads.length).getValues()[0];
  var merged = heads.map(function (h, i) { return obj[h] !== undefined ? obj[h] : current[i]; });
  sheet.getRange(rowIndex, 1, 1, heads.length).setValues([merged]);
}

/**
 * Como rowsAsObjects_(), mas com cache curto (CacheService, alguns
 * segundos) — só para abas de REFERÊNCIA, que mudam raramente mas são
 * lidas em quase toda ação (Analistas, Colaboradores). Cada ação num
 * chamado (responder, mudar status, transferir...) já lia essas duas
 * abas inteiras várias vezes (uma vez dentro de getCurrentUser(), de
 * novo em colaboradorInfoPorMatricula_(), de novo em
 * analistasPorEmail_()...) — isso é boa parte do "demora pra trocar de
 * tela / enviar mensagem" sentido no dia a dia.
 *
 * NUNCA usar em abas que o próprio pedido pode ter acabado de escrever
 * (Chamados, Historico, Anexos) — cache desatualizado ali esconderia a
 * própria escrita que acabou de acontecer. Também não usar antes de uma
 * escrita que depende do índice de linha (`_row`) estar exato agora (ver
 * verifyCpf() em Code.gs, que lê Colaboradores sem cache de propósito, e
 * limpa o cache logo depois de escrever).
 */
function rowsAsObjectsCached_(sheetName, headers, ttlSeconds) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'rows_' + sheetName;
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  var rows = rowsAsObjects_(sheet_(sheetName, headers));
  try {
    cache.put(cacheKey, JSON.stringify(rows), ttlSeconds);
  } catch (e) {
    // Aba grande demais pro limite do CacheService (~100KB por valor) —
    // segue sem cachear desta vez, sem quebrar nada.
  }
  return rows;
}

/** Descarta o cache de uma aba de referência — usar logo depois de
 * escrever nela (ver verifyCpf()), pra próxima leitura já vir atualizada
 * em vez de esperar o TTL expirar sozinho. */
function invalidateRowsCache_(sheetName) {
  CacheService.getScriptCache().remove('rows_' + sheetName);
}

function findRowById_(sheet, idColumn, id) {
  var rows = rowsAsObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idColumn]) === String(id)) return rows[i];
  }
  return null;
}
