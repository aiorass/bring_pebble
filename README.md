# Bring! para Pebble

Watchapp para Pebble (incluye el hardware 2026 de Core Devices: Pebble Time 2
"emery", Pebble Round 2 "gabbro" y Pebble 2 Duo "flint") que sincroniza con tu
lista de compras de [Bring!](https://www.getbring.com/).

Bring! no tiene una API pública oficial. Esta app usa la API REST no oficial
que la comunidad reverse-engineered (la misma que usa la integración de
[Home Assistant](https://www.home-assistant.io/integrations/bring/), vía
[miaucl/bring-api](https://github.com/miaucl/bring-api)). Puede dejar de
funcionar si Bring! cambia su backend.

## Cómo funciona

- **`src/c/bring_pebble.c`**: la UI del reloj. Un `MenuLayer` con "+ Agregar
  item" arriba (dictado por voz) y la lista debajo (`[ ]`/`[x]` según si ya
  se compró). Tocar un item lo marca/desmarca.
- **`src/pkjs/`**: el puente en el teléfono (PebbleKit JS). El reloj *nunca*
  habla directo con Bring!, solo intercambia mensajes cortos (`AppMessage`)
  con el teléfono, que es quien hace las llamadas HTTPS a `api.getbring.com`.
  - `bring-api.js`: cliente de la API de Bring! (login, refresh de token,
    leer lista, agregar/completar/reactivar items).
  - `config.js`: genera la pantalla de configuración (login + selección de
    lista) que se abre en el navegador del teléfono.
  - `index.js`: conecta todo — responde a los mensajes del reloj y a los
    eventos de configuración.

## Configurar tu cuenta

1. Instalá la app en el reloj (ver abajo).
2. En el teléfono, abrí la app Pebble → esta app → **Configuración**.
3. Ingresá tu email y contraseña de Bring!, elegí la lista, y guardá.
4. El reloj sincroniza automáticamente apenas se guarda la configuración.

El email/contraseña se guardan solo en el `localStorage` de la app Pebble en
ese teléfono (no se envían nunca al reloj). Se usa la contraseña para volver
a loguear si el refresh token expira; si eso te preocupa, es fácil cambiar
`bring-api.js` para no persistirla y simplemente re-pedir el login cuando el
refresh falle.

## Compilar e instalar

```sh
pebble build                          # compila las 7 plataformas
pebble install --emulator emery       # probar en el emulador (Pebble Time 2)
pebble install --phone <ip>           # instalar en un reloj real emparejado
```

## Limitaciones conocidas

- **Pantallas redondas (chalk / gabbro)**: el título de sección "Lista de
  compras" queda recortado contra el borde curvo de la pantalla (se corta
  la "L" inicial). Es un detalle de layout del `MenuLayer` pendiente de
  ajustar; el resto de la app funciona igual.
- **Sin edición de texto en el reloj**: agregar items usa dictado por voz
  (`dictation_session`). En hardware sin micrófono (aplite/basalt/chalk/
  diorite) esa opción no va a funcionar; el reloj sigue mostrando y
  sincronizando la lista igual.
- **Reintentos de sincronización**: si el teléfono tarda en reconectar
  Bluetooth, el reloj reintenta el pedido de sync cada 4s hasta 6 veces antes
  de mostrar un error.
- **Traducción de items de catálogo**: los items elegidos del catálogo de
  Bring! (no los escritos a mano) se guardan en el backend bajo un nombre
  canónico en alemán y se traducen automáticamente al idioma de la cuenta
  usando el diccionario público de locale de Bring!. Cubre los idiomas más
  comunes (`es-ES`, `en-US`, `fr-FR`, etc. — ver `BRING_SUPPORTED_LOCALES`
  en `bring-api.js`); una variante regional muy específica no listada ahí
  podría no traducirse.

## Probado

- `pebble build` compila sin errores en las 7 plataformas.
- El round-trip de `AppMessage` (reloj ⇄ pkjs) se probó en el emulador
  `emery`: el reloj pide sync, el teléfono responde y el reloj muestra el
  estado "no configurado" correctamente.
- El flujo completo de login/lista de Bring! se probó contra la API real
  con una cuenta real: login, sincronización automática al abrir la app,
  agregar/marcar/desmarcar items (a mano y por voz) y traducción de items
  de catálogo, todo confirmado funcionando de punta a punta.
