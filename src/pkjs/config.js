// Builds the phone-side configuration screen (a self-contained data: URI, no
// server required). This is a single screen on purpose: opening a *second*
// webview from inside the async callback that follows it (i.e. after the
// login network call finishes) is not reliably honored by the host app, so
// everything the user needs to enter has to fit on the one page that's
// already open. Bring!'s API also has no CORS headers and rejects requests
// from a browser/webview origin, so this page makes no network calls itself
// — it only collects input and hands it back via pebblejs://close#....

function pageShell(title, bodyHtml, script) {
  return '' +
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Bring! para Pebble</title>' +
    '<style>' +
    'body{font-family:sans-serif;margin:0;padding:16px;background:#fff;color:#222;}' +
    'h1{font-size:18px;}' +
    'p{font-size:13px;color:#555;}' +
    'label{display:block;margin-top:12px;font-size:13px;color:#555;}' +
    'input{width:100%;box-sizing:border-box;padding:8px;font-size:16px;margin-top:4px;}' +
    'button{margin-top:16px;width:100%;padding:12px;font-size:16px;background:#e94e3c;color:#fff;border:none;border-radius:4px;}' +
    '.err{margin-top:12px;font-size:13px;color:#c0392b;white-space:pre-wrap;}' +
    '</style></head><body>' +
    '<h1>' + title + '</h1>' +
    bodyHtml +
    '<script>' + script + '</script>' +
    '</body></html>';
}

function buildCredentialsUrl(current) {
  var email = (current && current.email) || '';
  var listName = (current && current.listName) || '';
  var error = (current && current.error) || '';
  var errorHtml = error ? '<div class="err">' + error.replace(/</g, '&lt;') + '</div>' : '';

  var body = '' +
    '<p>Tu email y contrasena se guardan solo en el almacenamiento local de la app Pebble en este telefono, para poder sincronizar la lista en segundo plano.</p>' +
    '<label>Email<input id="email" type="email" autocapitalize="none" value="' + email.replace(/"/g, '&quot;') + '"></label>' +
    '<label>Contrasena<input id="password" type="password"></label>' +
    '<label>Nombre de la lista (opcional)<input id="listName" type="text" placeholder="Dejar vacio = tu lista principal" value="' + listName.replace(/"/g, '&quot;') + '"></label>' +
    '<button id="go">Guardar</button>' +
    errorHtml;

  var script = '' +
    'function bringGetReturnTo() {' +
    '  var query = location.search.substring(1);' +
    '  var vars = query.length ? query.split("&") : [];' +
    '  for (var i = 0; i < vars.length; i++) {' +
    '    var pair = vars[i].split("=");' +
    '    if (pair[0] === "return_to") { return decodeURIComponent(pair[1]); }' +
    '  }' +
    '  return "pebblejs://close#";' +
    '}' +
    'document.getElementById("go").onclick = function () {' +
    '  var email = document.getElementById("email").value.trim();' +
    '  var password = document.getElementById("password").value;' +
    '  var listName = document.getElementById("listName").value.trim();' +
    '  if (!email || !password) { return; }' +
    '  var payload = { email: email, password: password, listName: listName };' +
    '  location.href = bringGetReturnTo() + encodeURIComponent(JSON.stringify(payload));' +
    '};';

  return 'data:text/html;charset=utf-8,' + encodeURIComponent(pageShell('Conecta tu cuenta de Bring!', body, script));
}

function parseConfigResponse(response) {
  try {
    return JSON.parse(decodeURIComponent(response));
  } catch (e1) {
    try {
      return JSON.parse(response);
    } catch (e2) {
      return null;
    }
  }
}

module.exports = {
  buildCredentialsUrl: buildCredentialsUrl,
  parseConfigResponse: parseConfigResponse
};
