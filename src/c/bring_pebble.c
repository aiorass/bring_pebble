#include <pebble.h>

// Must match the action values used in src/pkjs/index.js
typedef enum {
  ACTION_REQUEST_SYNC   = 0, // watch -> phone: "send me the current list"
  ACTION_SYNC_ITEM      = 1, // phone -> watch: one item (itemIndex, itemName, itemDone)
  ACTION_SYNC_DONE      = 2, // phone -> watch: end of the item stream
  ACTION_TOGGLE_ITEM    = 3, // watch -> phone: item at itemIndex now has itemDone
  ACTION_ADD_ITEM       = 4, // watch -> phone: add itemName to the list
  ACTION_ERROR          = 5, // phone -> watch: errorMsg describes what went wrong
  ACTION_NOT_CONFIGURED = 6, // phone -> watch: no Bring! account configured yet
  ACTION_SYNC_START     = 7, // phone -> watch: a fresh item stream is starting, discard the old one
} BringAction;

#define MAX_ITEMS 80
#define MAX_NAME_LEN 48
#define DICTATION_BUFFER_SIZE 128

// Must match the category order in src/pkjs/categorize.js
#define ICON_CATEGORY_COUNT 8
static const uint32_t CATEGORY_RESOURCE_IDS[ICON_CATEGORY_COUNT] = {
  RESOURCE_ID_ICON_DEFAULT,
  RESOURCE_ID_ICON_BREAD,
  RESOURCE_ID_ICON_DAIRY,
  RESOURCE_ID_ICON_FRUIT,
  RESOURCE_ID_ICON_VEGETABLE,
  RESOURCE_ID_ICON_MEAT,
  RESOURCE_ID_ICON_DRINK,
  RESOURCE_ID_ICON_CLEANING,
};

typedef struct {
  char name[MAX_NAME_LEN];
  bool done;
  uint8_t icon;
} BringItem;

typedef enum {
  STATE_LOADING,
  STATE_READY,
  STATE_ERROR,
  STATE_NOT_CONFIGURED,
} AppState;

static Window *s_window;
static MenuLayer *s_menu_layer;
static TextLayer *s_message_layer;
static DictationSession *s_dictation_session;
static GBitmap *s_category_icons[ICON_CATEGORY_COUNT];
static GBitmap *s_add_icon;

static BringItem s_items[MAX_ITEMS];
static int s_item_count = 0;
static AppState s_state = STATE_LOADING;
static char s_message_text[140];

#define SYNC_RETRY_INTERVAL_MS 4000
#define MAX_SYNC_RETRIES 6

static AppTimer *s_retry_timer;
static int s_retry_count = 0;

static void update_ui(void);

// ---------------------------------------------------------------------------
// AppMessage: outgoing
//
// The phone-side JS may not be attached yet when the watch app starts (e.g.
// Bluetooth just reconnected), so the initial sync request is retried with a
// simple fixed interval until an answer (items, error, or "not configured")
// comes back.
// ---------------------------------------------------------------------------

static void send_request_sync_message(void) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_action, ACTION_REQUEST_SYNC);
  app_message_outbox_send();
}

static void retry_timer_callback(void *data) {
  s_retry_timer = NULL;
  if (s_state != STATE_LOADING) {
    return; // an answer arrived while we were waiting to retry
  }
  s_retry_count++;
  if (s_retry_count > MAX_SYNC_RETRIES) {
    s_state = STATE_ERROR;
    strncpy(s_message_text,
            "No se pudo conectar con el telefono.\n\nRevisa que la app Pebble este abierta y Bluetooth conectado.",
            sizeof(s_message_text) - 1);
    s_message_text[sizeof(s_message_text) - 1] = '\0';
    update_ui();
    return;
  }
  send_request_sync_message();
  s_retry_timer = app_timer_register(SYNC_RETRY_INTERVAL_MS, retry_timer_callback, NULL);
}

static void request_sync(void) {
  s_item_count = 0;
  s_retry_count = 0;
  s_state = STATE_LOADING;
  update_ui();

  if (s_retry_timer) {
    app_timer_cancel(s_retry_timer);
  }
  send_request_sync_message();
  s_retry_timer = app_timer_register(SYNC_RETRY_INTERVAL_MS, retry_timer_callback, NULL);
}

static void send_toggle_item(int index, const char *name, bool done) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_action, ACTION_TOGGLE_ITEM);
  dict_write_int32(iter, MESSAGE_KEY_itemIndex, index);
  dict_write_cstring(iter, MESSAGE_KEY_itemName, name);
  dict_write_int32(iter, MESSAGE_KEY_itemDone, done ? 1 : 0);
  app_message_outbox_send();
}

static void send_add_item(const char *name) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_action, ACTION_ADD_ITEM);
  dict_write_cstring(iter, MESSAGE_KEY_itemName, name);
  app_message_outbox_send();
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

static void show_message(const char *text) {
  text_layer_set_text(s_message_layer, text);
  layer_set_hidden(text_layer_get_layer(s_message_layer), false);
  layer_set_hidden(menu_layer_get_layer(s_menu_layer), true);
}

static void update_ui(void) {
  switch (s_state) {
    case STATE_LOADING:
      show_message("Sincronizando con Bring!...");
      break;
    case STATE_NOT_CONFIGURED:
      show_message("Configura tu cuenta de Bring!\n\nEn el telefono: app Pebble > esta app > Configuracion.");
      break;
    case STATE_ERROR:
      show_message(s_message_text);
      break;
    case STATE_READY:
      layer_set_hidden(text_layer_get_layer(s_message_layer), true);
      layer_set_hidden(menu_layer_get_layer(s_menu_layer), false);
      menu_layer_reload_data(s_menu_layer);
      break;
  }
}

// ---------------------------------------------------------------------------
// Dictation (voice input for "add item")
// ---------------------------------------------------------------------------

static void dictation_session_callback(DictationSession *session, DictationSessionStatus status,
                                        char *transcription, void *context) {
  if (status == DictationSessionStatusSuccess) {
    send_add_item(transcription);
  }
  // On failure/cancel the dictation UI already showed its own message; nothing else to do.
}

// ---------------------------------------------------------------------------
// MenuLayer callbacks
//
// Section 0 has a single "+ Agregar item" row. Section 1 lists the current
// Bring! items, prefixed with [ ] / [x] to show purchased state.
// ---------------------------------------------------------------------------

static uint16_t menu_get_num_sections_callback(MenuLayer *menu_layer, void *context) {
  return 2;
}

static uint16_t menu_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  if (section_index == 0) {
    return 1;
  }
  return (uint16_t)s_item_count;
}

static int16_t menu_get_header_height_callback(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  return (section_index == 1 && s_item_count > 0) ? MENU_CELL_BASIC_HEADER_HEIGHT : 0;
}

static void menu_draw_header_callback(GContext *ctx, const Layer *cell_layer, uint16_t section_index,
                                       void *context) {
  if (section_index == 1) {
    menu_cell_basic_header_draw(ctx, cell_layer, "Lista de compras");
  }
}

static void menu_draw_row_callback(GContext *ctx, const Layer *cell_layer, MenuIndex *cell_index, void *context) {
  if (cell_index->section == 0) {
    menu_cell_basic_draw(ctx, cell_layer, "+ Agregar item", "Dictado por voz", s_add_icon);
    return;
  }

  static char s_row_buffer[MAX_NAME_LEN + 4];
  BringItem *item = &s_items[cell_index->row];
  snprintf(s_row_buffer, sizeof(s_row_buffer), "%s%s", item->done ? "[x] " : "[ ] ", item->name);
  GBitmap *icon = (item->icon < ICON_CATEGORY_COUNT) ? s_category_icons[item->icon] : NULL;
  menu_cell_basic_draw(ctx, cell_layer, s_row_buffer, NULL, icon);
}

static void menu_select_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *context) {
  if (cell_index->section == 0) {
    if (s_dictation_session) {
      dictation_session_start(s_dictation_session);
    }
    return;
  }

  BringItem *item = &s_items[cell_index->row];
  item->done = !item->done;
  send_toggle_item(cell_index->row, item->name, item->done);
  menu_layer_reload_data(s_menu_layer);
}

// ---------------------------------------------------------------------------
// AppMessage: incoming
// ---------------------------------------------------------------------------

static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  Tuple *action_tuple = dict_find(iterator, MESSAGE_KEY_action);
  if (!action_tuple) {
    return;
  }

  switch ((BringAction)action_tuple->value->int32) {
    case ACTION_SYNC_START:
      s_item_count = 0;
      break;
    case ACTION_SYNC_ITEM: {
      Tuple *idx_t = dict_find(iterator, MESSAGE_KEY_itemIndex);
      Tuple *name_t = dict_find(iterator, MESSAGE_KEY_itemName);
      Tuple *done_t = dict_find(iterator, MESSAGE_KEY_itemDone);
      Tuple *icon_t = dict_find(iterator, MESSAGE_KEY_itemIcon);
      if (!idx_t || !name_t || !done_t) {
        break;
      }
      int idx = (int)idx_t->value->int32;
      if (idx < 0 || idx >= MAX_ITEMS) {
        break;
      }
      strncpy(s_items[idx].name, name_t->value->cstring, MAX_NAME_LEN - 1);
      s_items[idx].name[MAX_NAME_LEN - 1] = '\0';
      s_items[idx].done = done_t->value->int32 != 0;
      s_items[idx].icon = 0;
      if (icon_t) {
        int icon = (int)icon_t->value->int32;
        if (icon >= 0 && icon < ICON_CATEGORY_COUNT) {
          s_items[idx].icon = (uint8_t)icon;
        }
      }
      if (idx + 1 > s_item_count) {
        s_item_count = idx + 1;
      }
      break;
    }
    case ACTION_SYNC_DONE:
      s_state = STATE_READY;
      update_ui();
      break;
    case ACTION_ERROR: {
      Tuple *msg_t = dict_find(iterator, MESSAGE_KEY_errorMsg);
      s_state = STATE_ERROR;
      if (msg_t) {
        strncpy(s_message_text, msg_t->value->cstring, sizeof(s_message_text) - 1);
        s_message_text[sizeof(s_message_text) - 1] = '\0';
      } else {
        strncpy(s_message_text, "Ocurrio un error al sincronizar.", sizeof(s_message_text) - 1);
      }
      update_ui();
      break;
    }
    case ACTION_NOT_CONFIGURED:
      s_state = STATE_NOT_CONFIGURED;
      update_ui();
      break;
    default:
      break;
  }
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage dropped: %d", (int)reason);
}

static void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage outbox failed: %d", (int)reason);
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks) {
    .get_num_sections = menu_get_num_sections_callback,
    .get_num_rows = menu_get_num_rows_callback,
    .get_header_height = menu_get_header_height_callback,
    .draw_header = menu_draw_header_callback,
    .draw_row = menu_draw_row_callback,
    .select_click = menu_select_callback,
  });
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));

  s_message_layer = text_layer_create(bounds);
  text_layer_set_text_alignment(s_message_layer, GTextAlignmentCenter);
  text_layer_set_font(s_message_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_overflow_mode(s_message_layer, GTextOverflowModeWordWrap);
  layer_add_child(window_layer, text_layer_get_layer(s_message_layer));

  s_dictation_session = dictation_session_create(DICTATION_BUFFER_SIZE, dictation_session_callback, NULL);

  for (int i = 0; i < ICON_CATEGORY_COUNT; i++) {
    s_category_icons[i] = gbitmap_create_with_resource(CATEGORY_RESOURCE_IDS[i]);
  }
  s_add_icon = gbitmap_create_with_resource(RESOURCE_ID_ICON_APP);

  update_ui();
  request_sync();
}

static void window_unload(Window *window) {
  if (s_retry_timer) {
    app_timer_cancel(s_retry_timer);
    s_retry_timer = NULL;
  }
  if (s_dictation_session) {
    dictation_session_destroy(s_dictation_session);
    s_dictation_session = NULL;
  }
  for (int i = 0; i < ICON_CATEGORY_COUNT; i++) {
    if (s_category_icons[i]) {
      gbitmap_destroy(s_category_icons[i]);
      s_category_icons[i] = NULL;
    }
  }
  if (s_add_icon) {
    gbitmap_destroy(s_add_icon);
    s_add_icon = NULL;
  }
  text_layer_destroy(s_message_layer);
  menu_layer_destroy(s_menu_layer);
}

static void init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
  });

  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_open(app_message_inbox_size_maximum(), app_message_outbox_size_maximum());

  window_stack_push(s_window, true);
}

static void deinit(void) {
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
