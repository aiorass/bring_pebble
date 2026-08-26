// Minimal client for the unofficial Bring! REST API, reverse-engineered by the
// community (see https://github.com/miaucl/bring-api, used by Home Assistant).
// Runs inside PebbleKit JS on the phone; the watch never talks to Bring! directly.

var BRING_BASE = 'https://api.getbring.com/rest/';
var BRING_API_KEY = 'cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp';
var DEFAULT_COUNTRY = 'DE'; // fallback only, used before the account's real country is known

// Bring! stores catalog items (picked from their in-app suggestions, as
// opposed to free-typed items) under a canonical German name regardless of
// the account's language, and translates them client-side using a public
// per-locale dictionary. Mirrors the locale handling in
// https://github.com/miaucl/bring-api (used by Home Assistant).
var BRING_DEFAULT_LOCALE = 'de-CH'; // catalog items are already in this locale: no translation needed
var BRING_SUPPORTED_LOCALES = [
  'de-AT', 'de-CH', 'de-DE', 'en-AU', 'en-CA', 'en-GB', 'en-US', 'es-ES',
  'fr-CH', 'fr-FR', 'hu-HU', 'it-CH', 'it-IT', 'nb-NO', 'nl-NL', 'pl-PL',
  'pt-BR', 'ru-RU', 'sv-SE', 'tr-TR'
];
var MAP_LANG_TO_LOCALE = {
  de: 'de-DE', en: 'en-US', es: 'es-ES', fr: 'fr-FR', hu: 'hu-HU', it: 'it-IT',
  nb: 'nb-NO', nl: 'nl-NL', pl: 'pl-PL', pt: 'pt-BR', ru: 'ru-RU', sv: 'sv-SE', tr: 'tr-TR'
};
var LOCALES_BASE_URL = 'https://web.getbring.com/locale/';

// { locale: { forward: {germanId: localizedText}, reverse: {localizedText: germanId} } }
// In-memory only: cheap enough to refetch if pkjs restarts, no need to burn localStorage on it.
var s_translationsCache = {};

function loadState() {
  return {
    email: localStorage.getItem('bring_email') || '',
    password: localStorage.getItem('bring_password') || '',
    uuid: localStorage.getItem('bring_uuid') || '',
    publicUuid: localStorage.getItem('bring_publicUuid') || '',
    accessToken: localStorage.getItem('bring_accessToken') || '',
    refreshToken: localStorage.getItem('bring_refreshToken') || '',
    tokenType: localStorage.getItem('bring_tokenType') || 'Bearer',
    expiresAt: parseInt(localStorage.getItem('bring_expiresAt') || '0', 10),
    listUuid: localStorage.getItem('bring_listUuid') || '',
    listName: localStorage.getItem('bring_listName') || '',
    locale: localStorage.getItem('bring_locale') || '',
    country: localStorage.getItem('bring_country') || ''
  };
}

// Remembers why configuration last failed, so the watch can show a useful
// message even if it wasn't open at the moment the phone-side login/list
// lookup failed (Settings is edited from the phone, not necessarily with
// the watchapp running).
function saveConfigError(message) {
  localStorage.setItem('bring_configError', message || '');
}

function loadConfigError() {
  return localStorage.getItem('bring_configError') || '';
}

function clearConfigError() {
  localStorage.removeItem('bring_configError');
}

function saveState(state) {
  var key;
  for (key in state) {
    if (state.hasOwnProperty(key) && state[key] !== undefined && state[key] !== null) {
      localStorage.setItem('bring_' + key, state[key]);
    }
  }
}

function formEncode(obj) {
  var parts = [];
  var k;
  for (k in obj) {
    if (obj.hasOwnProperty(k)) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
    }
  }
  return parts.join('&');
}

function authHeaders(state) {
  var h = {
    'X-BRING-API-KEY': BRING_API_KEY,
    'X-BRING-CLIENT': 'android',
    'X-BRING-APPLICATION': 'bring',
    'X-BRING-COUNTRY': state.country || DEFAULT_COUNTRY
  };
  if (state.tokenType && state.accessToken) {
    h['Authorization'] = state.tokenType + ' ' + state.accessToken;
  }
  if (state.uuid) {
    h['X-BRING-USER-UUID'] = state.uuid;
  }
  if (state.publicUuid) {
    h['X-BRING-PUBLIC-USER-UUID'] = state.publicUuid;
  }
  return h;
}

function xhrRequest(method, url, headers, body, callback) {
  var xhr = new XMLHttpRequest();
  xhr.timeout = 15000;
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      var data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (e) {
        // Some endpoints return an empty body on success; that's fine.
      }
      callback(null, data, xhr.status);
    } else {
      callback(new Error('HTTP ' + xhr.status), null, xhr.status);
    }
  };
  xhr.onerror = function () {
    callback(new Error('network error'), null, 0);
  };
  xhr.ontimeout = function () {
    callback(new Error('timeout'), null, 0);
  };
  xhr.open(method, url, true);
  var k;
  for (k in headers) {
    if (headers.hasOwnProperty(k)) {
      xhr.setRequestHeader(k, headers[k]);
    }
  }
  xhr.send(body || null);
}

function login(email, password, callback) {
  var headers = authHeaders({});
  headers['Content-Type'] = 'application/x-www-form-urlencoded';
  var body = formEncode({ email: email, password: password });
  xhrRequest('POST', BRING_BASE + 'v2/bringauth', headers, body, callback);
}

function refreshToken(state, callback) {
  var headers = authHeaders(state);
  headers['Content-Type'] = 'application/x-www-form-urlencoded';
  var body = formEncode({ grant_type: 'refresh_token', refresh_token: state.refreshToken });
  xhrRequest('POST', BRING_BASE + 'v2/bringauth/token', headers, body, callback);
}

function resolveLocale(language, country) {
  var candidate = language + '-' + country;
  if (BRING_SUPPORTED_LOCALES.indexOf(candidate) >= 0) {
    return candidate;
  }
  return MAP_LANG_TO_LOCALE[language] || BRING_DEFAULT_LOCALE;
}

function fetchUserLocale(state, callback) {
  var headers = authHeaders(state);
  xhrRequest('GET', BRING_BASE + 'v2/bringusers/' + state.uuid, headers, null, function (err, data) {
    if (err || !data || !data.userLocale) {
      callback(err || new Error('missing userLocale'));
      return;
    }
    callback(null, data.userLocale);
  });
}

// Best-effort: figures out the account's real language/country (like the
// official app does) so catalog items can be shown translated instead of in
// German. Never fails the caller — if this can't be determined, callers just
// fall back to BRING_DEFAULT_LOCALE (untranslated) for this round.
function applyUserLocale(state, callback) {
  if (state.locale && state.country) {
    callback(state);
    return;
  }
  fetchUserLocale(state, function (err, userLocale) {
    if (err) {
      callback(state);
      return;
    }
    state.country = userLocale.country || DEFAULT_COUNTRY;
    state.locale = resolveLocale(userLocale.language || 'de', state.country);
    saveState(state);
    callback(state);
  });
}

function buildReverseDict(dict) {
  var rev = {};
  var k;
  for (k in dict) {
    if (dict.hasOwnProperty(k)) {
      rev[dict[k]] = k;
    }
  }
  return rev;
}

// dict.forward: {germanCatalogId: localizedText}, dict.reverse: the opposite,
// used to recover the real itemId when the watch reports back a translated
// name (e.g. after toggling an item).
function loadTranslations(locale, callback) {
  if (locale === BRING_DEFAULT_LOCALE) {
    callback({ forward: {}, reverse: {} });
    return;
  }
  if (s_translationsCache[locale]) {
    callback(s_translationsCache[locale]);
    return;
  }
  xhrRequest('GET', LOCALES_BASE_URL + 'articles.' + locale + '.json', {}, null, function (err, data) {
    if (err || !data) {
      callback({ forward: {}, reverse: {} }); // transient failure: don't cache, retry next sync
      return;
    }
    var entry = { forward: data, reverse: buildReverseDict(data) };
    s_translationsCache[locale] = entry;
    callback(entry);
  });
}

function loginAndSave(state, callback) {
  login(state.email, state.password, function (err, data) {
    if (err || !data || !data.access_token) {
      callback(err || new Error('login failed'));
      return;
    }
    state.uuid = data.uuid;
    state.publicUuid = data.publicUuid;
    state.accessToken = data.access_token;
    state.refreshToken = data.refresh_token;
    state.tokenType = data.token_type || 'Bearer';
    state.expiresAt = Date.now() + (data.expires_in * 1000) - 30000;
    saveState(state);
    callback(null, state);
  });
}

// Makes sure `state` has a non-expired access token, refreshing or
// re-logging in as needed, then hands the up-to-date state to `callback`.
function ensureAuth(callback) {
  var state = loadState();
  if (!state.email || !state.password || !state.listUuid) {
    callback(new Error('not configured'));
    return;
  }
  function withLocale(s) {
    applyUserLocale(s, function (s2) { callback(null, s2); });
  }
  if (state.accessToken && state.expiresAt > Date.now()) {
    withLocale(state);
    return;
  }
  if (state.refreshToken) {
    refreshToken(state, function (err, data) {
      if (!err && data && data.access_token) {
        state.accessToken = data.access_token;
        state.tokenType = data.token_type || 'Bearer';
        state.expiresAt = Date.now() + (data.expires_in * 1000) - 30000;
        saveState(state);
        withLocale(state);
        return;
      }
      loginAndSave(state, function (err2, s2) {
        if (err2) { callback(err2); return; }
        withLocale(s2);
      });
    });
    return;
  }
  loginAndSave(state, function (err2, s2) {
    if (err2) { callback(err2); return; }
    withLocale(s2);
  });
}

function loadLists(state, callback) {
  var headers = authHeaders(state);
  xhrRequest('GET', BRING_BASE + 'bringusers/' + state.uuid + '/lists', headers, null, function (err, data) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, (data && data.lists) || []);
  });
}

// Used by the configuration flow: logs in with fresh credentials, then lists
// the account's shopping lists so the user can pick one. Runs entirely in
// PebbleKit JS (not the configuration webview) because Bring!'s API has no
// CORS headers and rejects browser-origin requests.
function authenticateAndListLists(email, password, callback) {
  login(email, password, function (err, data) {
    if (err || !data || !data.access_token) {
      callback(err || new Error('login failed'));
      return;
    }
    var state = {
      email: email,
      password: password,
      uuid: data.uuid,
      publicUuid: data.publicUuid,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type || 'Bearer',
      expiresAt: Date.now() + (data.expires_in * 1000) - 30000
    };
    applyUserLocale(state, function (state2) {
      loadLists(state2, function (err2, lists) {
        if (err2) {
          callback(err2);
          return;
        }
        callback(null, state2, lists, data.bringListUUID);
      });
    });
  });
}

function translateItemIds(list, forwardDict) {
  var i;
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].itemId && forwardDict[list[i].itemId]) {
      list[i].itemId = forwardDict[list[i].itemId];
    }
  }
}

function getListItems(state, callback) {
  var headers = authHeaders(state);
  xhrRequest('GET', BRING_BASE + 'v2/bringlists/' + state.listUuid, headers, null, function (err, data) {
    if (err) {
      callback(err);
      return;
    }
    var items = (data && data.items) || { purchase: [], recently: [] };
    loadTranslations(state.locale || BRING_DEFAULT_LOCALE, function (dict) {
      translateItemIds(items.purchase, dict.forward);
      translateItemIds(items.recently, dict.forward);
      callback(null, items);
    });
  });
}

// operation: 'TO_PURCHASE' (add / move back to the shopping list),
//            'TO_RECENTLY' (mark as bought / completed)
function updateItem(state, itemName, operation, callback) {
  // itemName may be a translated catalog name (e.g. "Coffee" shown on the
  // watch); Bring! only recognizes the German canonical id ("Kaffee") server
  // side, so it has to be translated back before sending. Free-typed items
  // just pass through unchanged since they won't be in the reverse dict.
  loadTranslations(state.locale || BRING_DEFAULT_LOCALE, function (dict) {
    var canonicalId = dict.reverse[itemName] || itemName;
    var headers = authHeaders(state);
    headers['Content-Type'] = 'application/json';
    var body = JSON.stringify({
      changes: [{
        accuracy: '0.0',
        altitude: '0.0',
        latitude: '0.0',
        longitude: '0.0',
        itemId: canonicalId,
        spec: '',
        uuid: null,
        operation: operation
      }],
      sender: ''
    });
    xhrRequest('PUT', BRING_BASE + 'v2/bringlists/' + state.listUuid + '/items', headers, body, callback);
  });
}

module.exports = {
  loadState: loadState,
  saveState: saveState,
  saveConfigError: saveConfigError,
  loadConfigError: loadConfigError,
  clearConfigError: clearConfigError,
  ensureAuth: ensureAuth,
  authenticateAndListLists: authenticateAndListLists,
  getListItems: getListItems,
  updateItem: updateItem
};
