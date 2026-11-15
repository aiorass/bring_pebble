var BringApi = require('./bring-api');
var Config = require('./config');
var Categorize = require('./categorize');

var ACTION_REQUEST_SYNC = 0;
var ACTION_SYNC_ITEM = 1;
var ACTION_SYNC_DONE = 2;
var ACTION_TOGGLE_ITEM = 3;
var ACTION_ADD_ITEM = 4;
var ACTION_ERROR = 5;
var ACTION_NOT_CONFIGURED = 6;
var ACTION_SYNC_START = 7;

// Trailing sentence punctuation (ASCII, ellipsis, CJK, Spanish inverted marks)
// and whitespace. Characters inside the text, and endings such as "%" or ")",
// are kept.
var TRAILING_PUNCTUATION = /[\s.,;:!?\u2026\u3001\u3002\uFF01\uFF0C\uFF1A\uFF1B\uFF1F\u00A1\u00BF]+$/;

var MAX_ITEMS = 80; // must match MAX_ITEMS in src/c/bring_pebble.c

function isConfigured() {
  var s = BringApi.loadState();
  return !!(s.email && s.password && s.listUuid);
}

function sendNotConfigured() {
  Pebble.sendAppMessage({ action: ACTION_NOT_CONFIGURED });
}

function sendError(message) {
  Pebble.sendAppMessage({ action: ACTION_ERROR, errorMsg: String(message).substring(0, 120) });
}

function sendItemsThenDone(items) {
  function afterStart() {
    var i = 0;
    function sendNext() {
      if (i >= items.length) {
        Pebble.sendAppMessage({ action: ACTION_SYNC_DONE });
        return;
      }
      var item = items[i];
      var index = i;
      Pebble.sendAppMessage(
        {
          action: ACTION_SYNC_ITEM,
          itemIndex: index,
          itemName: item.name,
          itemDone: item.done ? 1 : 0,
          itemIcon: Categorize.categorize(item.name)
        },
        function () { i++; sendNext(); },
        function () { i++; sendNext(); } // best-effort: skip a dropped item instead of stalling the sync
      );
    }
    sendNext();
  }
  // Tells the watch to discard its current list before the new one streams
  // in, so a shrunk list (e.g. an item got completed) doesn't leave stale
  // rows behind.
  Pebble.sendAppMessage({ action: ACTION_SYNC_START }, afterStart, afterStart);
}

function doSync() {
  if (!isConfigured()) {
    var configError = BringApi.loadConfigError();
    if (configError) {
      sendError(configError);
    } else {
      sendNotConfigured();
    }
    return;
  }
  BringApi.ensureAuth(function (authErr, state) {
    if (authErr) {
      sendError('No se pudo conectar con Bring!: revisa tu configuracion.');
      return;
    }
    BringApi.getListItems(state, function (err, items) {
      if (err) {
        sendError('Error al leer la lista de Bring!');
        return;
      }
      var merged = [];
      var i;
      for (i = 0; i < items.purchase.length; i++) {
        merged.push({ name: items.purchase[i].itemId, done: false });
      }
      for (i = 0; i < items.recently.length; i++) {
        merged.push({ name: items.recently[i].itemId, done: true });
      }
      sendItemsThenDone(merged.slice(0, MAX_ITEMS));
    });
  });
}

Pebble.addEventListener('ready', function () {
  console.log('Bring! companion ready');
});

Pebble.addEventListener('appmessage', function (e) {
  var payload = e.payload;
  console.log('appmessage received, action=' + payload.action);

  if (payload.action === ACTION_REQUEST_SYNC) {
    doSync();
    return;
  }

  if (payload.action === ACTION_TOGGLE_ITEM) {
    if (!isConfigured()) {
      sendNotConfigured();
      return;
    }
    var toggleOp = payload.itemDone ? 'TO_RECENTLY' : 'TO_PURCHASE';
    BringApi.ensureAuth(function (authErr, state) {
      if (authErr) {
        sendError('No se pudo conectar con Bring!: revisa tu configuracion.');
        return;
      }
      BringApi.updateItem(state, payload.itemName, toggleOp, function () {
        // Re-sync regardless of success so the watch always reflects server state.
        doSync();
      });
    });
    return;
  }

  if (payload.action === ACTION_ADD_ITEM) {
    if (!isConfigured()) {
      sendNotConfigured();
      return;
    }
    // Voice dictation often appends sentence punctuation ("Milk."); drop it.
    var name = (payload.itemName || '').trim().replace(TRAILING_PUNCTUATION, '');
    if (!name) {
      doSync();
      return;
    }
    BringApi.ensureAuth(function (authErr, state) {
      if (authErr) {
        sendError('No se pudo conectar con Bring!: revisa tu configuracion.');
        return;
      }
      BringApi.updateItem(state, name, 'TO_PURCHASE', function () {
        doSync();
      });
    });
  }
});

Pebble.addEventListener('showConfiguration', function () {
  var current = BringApi.loadState();
  Pebble.openURL(Config.buildCredentialsUrl({ email: current.email, listName: current.listName }));
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e.response) {
    return; // user cancelled
  }
  var data = Config.parseConfigResponse(e.response);
  if (!data) {
    return;
  }
  var email = (data.email || '').trim();
  var password = data.password || '';
  var wantedListName = (data.listName || '').trim();
  if (!email || !password) {
    return;
  }

  // Login + list lookup happens here in pkjs (native networking), not in
  // the configuration webview, since Bring!'s API has no CORS headers and
  // blocks requests coming from a browser/webview origin.
  BringApi.authenticateAndListLists(email, password, function (err, state, lists, defaultListUuid) {
    if (err || !lists || !lists.length) {
      var message = err
        ? 'No se pudo iniciar sesion en Bring!. Revisa tu email y contrasena desde Configuracion.'
        : 'Tu cuenta de Bring! no tiene listas.';
      BringApi.saveConfigError(message);
      sendError(message); // reaches the watch if it happens to be open right now
      return;
    }

    var chosen = null;
    var i;
    if (wantedListName) {
      for (i = 0; i < lists.length; i++) {
        if (lists[i].name.toLowerCase() === wantedListName.toLowerCase()) {
          chosen = lists[i];
          break;
        }
      }
      if (!chosen) {
        BringApi.saveConfigError('No se encontro una lista llamada "' + wantedListName + '". Revisa el nombre desde Configuracion.');
        sendError(BringApi.loadConfigError());
        return;
      }
    } else {
      for (i = 0; i < lists.length; i++) {
        if (lists[i].listUuid === defaultListUuid) {
          chosen = lists[i];
          break;
        }
      }
      if (!chosen) {
        chosen = lists[0];
      }
    }

    state.listUuid = chosen.listUuid;
    state.listName = chosen.name;
    BringApi.saveState(state);
    BringApi.clearConfigError();
    doSync();
  });
});
