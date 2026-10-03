# VERSORIUM — Brand, tokens, themes, type

> **Nota (2026-10-03).** Esto es la especificación de diseño tal como se pidió; no se ha reescrito. Lo que se entregó está en `STATUS.md`; `TODO.md` lista parte de lo que falta, no todo. Los puntos donde la app entregada difiere de este documento están al final, en "Implementation notes (2026-10-03)".

Nombre: **Versorium** (instrumento que señala). Marca: minúsculas en UI `versorium`, título `Versorium`.
Accent de producto (chrome, no del editor): **Needle Teal** `#2A6F6A` light / `#7EB8B2` dark.
No usar naranja iA Writer ni púrpura Ulysses como acento de marca.

Radio: 8px controles, 12px cards, 16px dialogs.
Espaciado: 4/8/12/16/24/32/48.
Contraste texto/fondo del editor: mínimo **7:1** (AAA body). Chrome UI 4.5:1.

El editor y el chrome **pueden** desacoplarse: theme de escritura ≠ theme de paneles. Default: van juntos.

---

## Qué dice la investigación (base del Theme 1)

- Papel **blanco puro + texto negro puro** cansa: contraste de luminancia excesivo en pantalla retroiluminada.
- Fondos **amarillo/verde de croma baja (~10)** se perciben más cómodos para leer que el blanco; el azul de croma media ayuda a *claridad*, no a confort. Optics Express 2024.
- Polaridad **texto oscuro sobre fondo claro** gana en legibilidad frente a claro-sobre-oscuro para texto denso.
- Sepia/crema reduce halos en astigmatismo vs dark mode extremo.
- Dark mode: **near-black cálido**, nunca `#000` + texto `#FFF`.
- Temperatura: ~4000–5000K de día (alerta); ~2700–3000K de noche (menos melatonin hit).

---

## Theme 1 — FOLIO (investigación)

Escritura larga de día. Papel de libro, tinta, cero RGB chillón.

### Light
| Token | Hex | Uso |
|---|---|---|
| `--bg-app` | `#E7DFD0` | app chrome |
| `--bg-editor` | `#F3ECDD` | página |
| `--bg-panel` | `#EDE6D6` | binder / inspector |
| `--bg-elev` | `#F7F1E6` | cards, menus |
| `--border` | `#D4CBB8` | |
| `--text` | `#2C261C` | body (tinta) |
| `--text-mute` | `#6F675A` | meta |
| `--accent` | `#3D5A45` | headings, focus ring |
| `--sel` | `#E2D3A8` | selección |
| `--ai` | `#5B4A6A` | spans escritos por IA (blame) |
| `--human` | `#2C261C` | spans humanos |
| `--warn` | `#8A5A2B` | cloud-leaving banner |
| `--ok` | `#3D5A45` | Ready / local |

### Dark
| Token | Hex |
|---|---|
| `--bg-app` | `#1C1914` |
| `--bg-editor` | `#242017` |
| `--bg-panel` | `#1F1C16` |
| `--bg-elev` | `#2C281F` |
| `--border` | `#3A352C` |
| `--text` | `#E8E0D0` |
| `--text-mute` | `#9A927F` |
| `--accent` | `#A3B89A` |
| `--sel` | `#3F3A2C` |
| `--ai` | `#C4B3D4` |
| `--warn` | `#D4A574` |

Default de primer launch **si es de día**: Folio Light.

---

## Theme 2 — QUARRY (industria + giro)

Lo que hacen iA Writer / Ulysses / Bear: gris cálido, UI invisible, página casi papel fotográfico. Giro Versorium: acento **Needle Teal** (no naranja, no lila) y un “page gutter” 72ch.

### Light
| Token | Hex |
|---|---|
| `--bg-app` | `#E8E6E1` |
| `--bg-editor` | `#F7F6F2` |
| `--bg-panel` | `#F0EEE9` |
| `--bg-elev` | `#FFFffb` |
| `--border` | `#D9D6CF` |
| `--text` | `#1A1A18` |
| `--text-mute` | `#6B6964` |
| `--accent` | `#2A6F6A` |
| `--sel` | `#D3E4E2` |
| `--ai` | `#6B4E8A` |
| `--warn` | `#B45309` |
| `--ok` | `#2A6F6A` |

### Dark
| Token | Hex |
|---|---|
| `--bg-app` | `#161615` |
| `--bg-editor` | `#1C1C1A` |
| `--bg-panel` | `#191918` |
| `--bg-elev` | `#262624` |
| `--border` | `#333330` |
| `--text` | `#EDECE8` |
| `--text-mute` | `#9C9A94` |
| `--accent` | `#7EB8B2` |
| `--sel` | `#2A3F3D` |
| `--ai` | `#C4B0E0` |
| `--warn` | `#E7B56A` |

Es el theme **más “producto serio de escritores”**. Default si el usuario elige “Industry”.

---

## Theme 3 — NEEDLE (sugerencia Versorium)

El que encaja con *nuestras* decisiones: MCP, blame humano/IA, banner de privacidad, noche larga, no parecer un ebook reader ni un IDE.

Fondo slate-teal (selenized-ish), texto cálido, acentos semánticos fuertes porque la UI *tiene* que distinguir Local / CLI / API.

### Light
| Token | Hex |
|---|---|
| `--bg-app` | `#E4EBE9` |
| `--bg-editor` | `#F4F7F6` |
| `--bg-panel` | `#E9EFED` |
| `--bg-elev` | `#FFFFFF` |
| `--border` | `#C5D0CD` |
| `--text` | `#1B2422` |
| `--text-mute` | `#5C6B68` |
| `--accent` | `#2A6F6A` |
| `--sel` | `#C5DDD9` |
| `--ai` | `#6E4C8A` |
| `--cli` | `#1F4E79` |
| `--local` | `#2A6F6A` |
| `--api` | `#8A4B2C` |
| `--warn` | `#9A3412` |

### Dark
| Token | Hex |
|---|---|
| `--bg-app` | `#0F1615` |
| `--bg-editor` | `#121C1A` |
| `--bg-panel` | `#101918` |
| `--bg-elev` | `#1A2624` |
| `--border` | `#2A3A37` |
| `--text` | `#E4EBE8` |
| `--text-mute` | `#8AA09B` |
| `--accent` | `#7EB8B2` |
| `--sel` | `#1E3A36` |
| `--ai` | `#C9B4E3` |
| `--cli` | `#8BB8E8` |
| `--local` | `#7EB8B2` |
| `--api` | `#E0A882` |
| `--warn` | `#E8B086` |

Default **de noche** o si hay muchos paneles MCP abiertos: Needle Dark.
Follow system: Folio de día, Needle de noche.

Tokens semánticos extra (todos los themes):
- `--privacy-local` / `--privacy-cli` / `--privacy-api` (barra inferior)
- `--diff-add` / `--diff-del` (preview antes de aplicar rewrite)

---

## Tipografía

### Chrome (UI)

Stack, no web font obligatorio:

```
system-ui, "Segoe UI Variable", "Segoe UI",
"SF Pro Text", -apple-system, "Inter Variable",
"Noto Sans", sans-serif
```

| OS | UI |
|---|---|
| macOS | SF Pro Text / Display |
| Windows | Segoe UI Variable |
| Linux | Inter si está; si no Cantarell / Noto Sans |

Tamaños UI: 12 meta, 13 controles, 14 body chrome.

### Editor (escritura) — default

**Source Serif 4** (OFL, variable) 20–22px, interlineado 1.7, measure **66–72ch**.  
Números / wordcount: **iA Writer Quattro** o **IBM Plex Mono** tabular.

Fallback inmediato (cero descarga):

```
"Iowan Old Style", "Palatino Linotype", Palatino,
"Liberation Serif", "Times New Roman", serif
```

### Catálogo descargable (OFL / SIL only)

Mismo patrón que modelos: Settings → Typography → tarjetas Download / Ready / Selected.

`fonts/catalog.json`: id, family, role (body|ui|mono), license, weight axis, url (Google Fonts / fontsource / GitHub release oficial), sha256, size.

Pack v1 (populares, libres, buenas en novela):

| Familia | Rol | Por qué |
|---|---|---|
| Source Serif 4 | body default | literario, variable, OFL |
| Literata | body | diseñada para lectura larga Google Play Books |
| Newsreader | body | periódico, excelente italic |
| Crimson Pro | body | Garamond-ish, novelas |
| Fraunces | display / títulos binder | carácter, no para 80k palabras |
| Atkinson Hyperlegible | body accesible | baja visión |
| IBM Plex Serif | body | neutra, bilingüe ES/EN |
| IBM Plex Mono | mono / git blame | |
| iA Writer Quattro | editor + UI opcional | ritmo de máquina de escribir, OFL |
| Inter | UI si no hay system | |
| Gentium Book Plus | body ES | diacríticos latinos impecables |
| Source Sans 3 | UI alternativa | |

Descarga a `~/…/Versorium/fonts/`. Registrar con `document.fonts`. Sin tracking de Google: preferir zip de Fontsource/GitHub, no CSS de fonts.google.com en runtime.

Auto-agregador:
1. Catálogo curado (arriba).
2. “Add from folder” (drop .ttf/.otf/.woff2).
3. Opcional: buscar en Google Fonts API **solo** familias OFL y cachear el archivo; nunca cargar el CSS remoto en cada keystroke.

No embeber 12 familias en el instalador (pesa). Llevar **Source Serif 4 + iA Writer Quattro + Inter** en el bundle (~1–2 MB woff2 subset latin-ext para ES). El resto on-demand.

OpenType del editor: `liga`, `kern`, `onum` off (tabular word counts), `pnum` en prosa, `ss01` si existe. Evitar justified en v1 (ríos).

---

## Motion / densidad

- Sin parallax. Transiciones 120–180ms ease-out.
- Focus mode: chrome se desvanece, editor centrado 72ch.
- Typewriter mode: línea activa al tercio inferior.
- Densidad compact | regular (default) | roomy.

---

## Logo (dirección, no asset final)

Instrumento Versorium visto de frente: aguja + círculo de rosa de vientos, 1 color Needle Teal sobre papel Folio. Favicon = solo la aguja. No pluma, no libro abierto (saturado en el gremio).

---

## Implementation notes (2026-10-03)

Lo que sigue no cambia ninguna decisión de arriba. Registra dónde la app entregada (rama `main` tras el PR #9) hace otra cosa, con la evidencia en el código y, si el código o un commit la dan, la razón. Varias de estas diferencias (catálogo de fuentes descargable, densidad, theme de editor separado del de paneles, spans de IA en el editor) no aparecen todavía en `TODO.md`, así que `TODO.md` no es la lista completa de lo que falta de este documento; esta sección sí intenta serlo.

**Lo que coincide, para que conste lo revisado:** los 75 valores hex de las seis tablas de Folio, Quarry y Needle están en `src/styles.css:8-143` sin una sola diferencia. Radios 8/12/16 (`src/styles.css:29-31`). Stack de UI (`src/styles.css:167-175`) y fallback serif del editor (`src/styles.css:621-628`) idénticos a los bloques de código de arriba. Dos matices del stack de UI: la tabla por sistema operativo pide Cantarell en Linux cuando no hay Inter, y Cantarell no está ni en ese stack ni en el stack `system-ui` del catálogo; y el stack `system-ui` del catálogo (`fonts/catalog.json:20`) omite "Inter Variable", así que no es igual al del chrome. Editor a 21px, interlineado 1.7, medida 72ch por defecto (`.cm-editor .cm-content` en `src/styles.css`, y los pasos medios de `src/lib/editor/preferences.ts`). Sin texto justificado. Contraste texto/fondo del editor entre 12.4:1 y 16.1:1 en los seis themes, por encima del 7:1 pedido. Focus mode desvanece el chrome (`src/styles.css:693-708`) y el typewriter deja la línea activa a 2/3 de la altura (`src/lib/editor/modes.ts:9`). Marca en minúsculas en la UI (`locales/en/ui.json:3`), `Versorium` como título de ventana (`src-tauri/tauri.conf.json:16`).

### Tokens y themes

- **Tokens añadidos que el spec no tiene.** `--accent-contrast` en los seis themes (`src/styles.css:18,43,64,85,106,130`): color del texto sobre un relleno de acento, usado por botones primarios y toggles activos (`src/styles.css:519-529`). `--ok` también en Folio Dark, Quarry Dark y los dos Needle (`src/styles.css:47,89,113,137`). El spec nombra `--privacy-*` y `--diff-*` sin valores; los valores los eligió el código (`src/styles.css:24-28` y equivalentes en cada theme).
- **Tokens definidos que nada usa.** `--human` (`src/styles.css:21`), `--cli` / `--local` / `--api` de Needle (`src/styles.css:109-111,133-135`) y `--privacy-api` no aparecen en ningún `var(...)` fuera de `styles.css`.
- **Spans de IA (blame) no se pintan.** La clase `.cm-ai-span` existe (`src/styles.css:682-686`), pero ningún código del editor la aplica.
- **Indicador de privacidad.** El spec lo pone en la barra inferior. La barra de estado no lo muestra (`src/lib/components/StatusBar.svelte:44-61`). Aparece solo como badge Local / CLI dentro del diálogo de Rewrite (`src/lib/components/RewriteDialog.svelte:163-168`), y no existe un tipo de proveedor API (`src/lib/components/RewriteDialog.svelte:46`).
- **`--warn` como banner de salida a la nube.** No existe ese banner. `--warn` marca errores, campos inválidos y cambios sin guardar en el historial (`src/styles.css:234`, `src/App.svelte:292`, `src/lib/components/StatusBar.svelte:52,71`).
- **Needle Teal como acento del chrome.** La cabecera ("Accent de producto (chrome, no del editor): **Needle Teal**") pide Needle Teal para el chrome; la tabla de Folio pide `#3D5A45` / `#A3B89A`. El código sigue la tabla (`src/styles.css:17,42`), así que en Folio (el theme por defecto) botones, foco, checkboxes y la marca de la app usan el verde de Folio, no Needle Teal. El test comprueba `--accent` = `#2a6f6a` solo en las variantes claras `quarry-light` y `needle-light` (`src/lib/themes/state.test.ts:89-94`); el `#7eb8b2` de las variantes oscuras no lo comprueba.
- **`--accent` en headings.** La tabla de Folio Light da a `--accent` el uso "headings, focus ring". Es el anillo de foco (`src/styles.css:250-255`), pero ningún heading lo usa: los headings del editor solo cambian peso y tamaño y quedan en `--text` (`src/styles.css:660-670`), y los títulos de sección del chrome van en `--text-mute` (`src/styles.css:554-560`).
- **Theme por defecto y "Follow system".** Una instalación nueva arranca en Folio con modo `follow` (`src-tauri/src/commands/settings.rs:200-201`). `follow` sigue la apariencia clara/oscura del sistema operativo, no la hora del día, y mantiene el theme elegido: de noche da Folio Dark, no Needle Dark (`src/lib/themes/state.svelte.ts:15-21`). Razón (commit `21bfb30`): la sustitución forzada por Needle hacía que el selector de theme no hiciera nada en cualquier máquina en modo oscuro. No hay regla de "muchos paneles MCP abiertos → Needle Dark", ni una opción llamada "Industry": Quarry se elige por su nombre en Ajustes → Apariencia (`src/lib/settings/groups/AppearanceGroup.svelte:70-76,105`).
- **Editor y chrome con themes distintos.** No es posible: un único `data-theme` en `<html>` gobierna los dos (`src/lib/themes/state.svelte.ts:21`).
- **Contraste del chrome (4.5:1).** Calculado el 2026-10-03 con la fórmula de luminancia relativa de WCAG 2 sobre los valores de `src/styles.css`, a mano; ningún test del repo lo comprueba. No llegan a 4.5:1: en Folio Light, `--text-mute` sobre `--bg-app` 4.21 y sobre `--bg-panel` 4.49, `--warn` sobre `--bg-app` 4.43; en Quarry Light, `--text-mute` sobre `--bg-app` 4.40, `--warn` sobre `--bg-app` 4.03 y sobre `--bg-panel` 4.33. Al menos una de esas parejas está en pantalla: la barra de estado escribe en `--text-mute` (`src/lib/components/StatusBar.svelte:46`) sobre el `--bg-app` del body (`src/styles.css:165`). Esas seis parejas usan colores del propio spec. Hay otra en pantalla con un color que eligió el código: la vista previa de Rewrite escribe las líneas borradas en `--warn` sobre `--diff-del` (`src/lib/components/RewriteDialog.svelte:194`), y el spec no da valores a `--diff-*`; en Folio Light `#8a5a2b` sobre `#ecd4c4` da 4.13 y en Quarry Light `#b45309` sobre `#f0d9c8` da 3.70 (`src/styles.css:22,28,67,73`). Las otras cuatro variantes pasan de 4.5:1 en esa pareja. No se revisó superficie por superficie.

### Tipografía

- **Catálogo de fuentes.** `fonts/catalog.json` tiene cuatro entradas: serif, sans y mono del sistema, más Source Serif 4 marcada `available: false`. Ninguna de las otras once familias del pack v1. Los campos son `id`, `family`, `role`, `stack`, `license`, `bundled`, `available`, `note`; no hay `url`, `sha256`, `size` ni eje de peso. Razón registrada en el propio archivo (`fonts/catalog.json:3`): el catálogo descargable llega con el descargador, y una entrada que no se puede instalar se marca como no disponible en lugar de darle una URL que no funciona.
- **Nada se descarga ni se incluye.** No hay botón Download ni estados Download / Ready (`src/lib/settings/TypographySection.svelte:87-89`), ningún archivo de fuente en el repo, ningún registro con `document.fonts`, ni "Add from folder", ni búsqueda en Google Fonts. Source Serif 4, iA Writer Quattro e Inter no van en el bundle.
- **Fuente por defecto del editor.** El ajuste por defecto es `system-serif` (`fonts/catalog.json:4`, `src-tauri/src/commands/settings.rs:216`). El CSS del editor pone "Source Serif 4" primero (`src/styles.css:621-628`), así que solo se ve si el escritor ya la tiene instalada.
- **La fuente elegida no llega al editor.** Ajustes → Editor → Tipografía (no "Settings → Typography") guarda la elección (`src-tauri/src/commands/polish.rs:54-60`), pero ningún código del frontend la lee para el editor: `api.editorFont()` solo se llama desde `src/lib/settings/TypographySection.svelte:24`, y la familia de `.cm-content` es fija (`src/styles.css:620-628`). Además, `editor_font` devuelve un stack CSS (`src-tauri/src/commands/polish.rs:45-49`) que la sección compara con un `id` (`src/lib/settings/TypographySection.svelte:26,57`); por lectura del código, la marca de "seleccionada" no coincidiría nunca. No verificado en la app en ejecución.
- **Tamaño, interlineado y medida se eligen.** El diseño fija 20–22px, interlineado 1.7 y medida 66–72ch. Ajustes → Editor (decisión del fundador del 2026-10-03) ofrece 18/21/24px, 1.5/1.7/2 y 60/72/84ch; los pasos del medio son los del diseño, los de siempre y los de una instalación nueva (`src/lib/editor/preferences.ts`). El mismo grupo pinta una banda tenue detrás del párrafo que tiene el cursor, `--sel` al 38 % (`.cm-activeLine` en `src/styles.css`); antes la regla la dejaba transparente y `highlightActiveLine()` no se veía.
- **Números y recuento de palabras.** No usan iA Writer Quattro ni IBM Plex Mono. El recuento de la barra de estado va en la fuente del chrome y sin `tabular-nums` (`src/lib/components/StatusBar.svelte:51`).
- **OpenType.** No hay `font-feature-settings` en ningún archivo de `src/`. Rigen los valores por defecto del navegador; `ss01` no se activa.
- **Tamaños de UI.** 14px para el chrome (`src/styles.css:176`) y 13px para controles (`src/styles.css:215,485`) coinciden. Además del 12px se usan 11px, 11.5px y 12.5px para texto secundario (por ejemplo `src/lib/settings/TypographySection.svelte:67`, `src/styles.css:515`). Por encima de la escala también hay tamaños: los títulos de diálogo van a 16px (`src/lib/components/RewriteDialog.svelte:141`, `src/lib/components/ConfirmDialog.svelte:40`, `src/lib/binder/NewProjectDialog.svelte:26` y otros), el título de la página de Ajustes a 18px (`src/lib/settings/SettingsPage.svelte:74`) y el de la pantalla vacía a 22px (`src/lib/components/EmptyState.svelte:59,66`).

### Espaciado, densidad y movimiento

- **Espaciado.** No hay tokens de espaciado, y hay valores fuera de la escala 4/8/12/16/24/32/48: relleno de campos 6px 10px (`src/styles.css:221`), de botones 6px 12px (`src/styles.css:484`), de elementos de lista 8px 10px (`src/styles.css:593`).
- **Densidad compact / regular / roomy.** No implementada; no existe ningún ajuste de densidad.
- **Transiciones.** Las del chrome duran 150 o 160ms con ease-out, dentro del rango del spec: 150ms en campos, bordes y botones (`src/styles.css:222,319,486-488`), 160ms en el desvanecido del focus mode y en las tarjetas del corkboard (`src/styles.css:694,717-719`). Ninguna usa 180ms. Dos excepciones: la barra de progreso de descarga de modelos anima su ancho en 300ms linear (`src/lib/settings/LocalAiSection.svelte:492`), y el fundido de opacidad de `CoverPreview` no declara curva (`transition: opacity 150ms;`, `src/lib/components/CoverPreview.svelte:58`), así que usa el `ease` por defecto del navegador, no ease-out.
- **Movimiento reducido.** Añadido que el spec no pide, y parcial: con `prefers-reduced-motion` solo se quitan las transiciones de `.v-chrome` y `.v-corkcard` (`src/styles.css:736-741`). Siguen activas las de campos, botones y selects (`src/styles.css:222,319,486-488`), la barra de progreso de modelos (`src/lib/settings/LocalAiSection.svelte:492`), el fundido de `CoverPreview` (`src/lib/components/CoverPreview.svelte:58`) y los indicadores de paso del onboarding (`src/lib/onboarding/Onboarding.svelte:53`).

### Logo e icono

- **La marca ya no es una aguja con rosa de vientos.** Es una "V" caligráfica inclinada, con el trazo grueso y el fino de una plumilla, y la plumilla que la dibujó al final del trazo (`tests/icons/generate.py:16-21`, `src/lib/components/VMark.svelte:2-13,25-34`). La plumilla es un elemento de pluma, que este spec excluye. Razón registrada (`tests/icons/generate.py:11-14`, commit `5e499a5`): una aguja dentro de un anillo es una brújula, y una brújula teal en un tile redondeado se reconocía como Safari.
- **Colores.** El set de iconos comprometido es la variante `paper`, letra teal sobre papel (`make icons` → `--variant paper`, `Makefile:98-99`), pero usa dos tonos: `#1A4A46` para el trazo grueso y la plumilla, y Needle Teal `#2A6F6A` para el trazo fino (`tests/icons/generate.py:65-66,78-88`), no un solo color. A 256px y más el generador dibuja además un tercer elemento, un charco de tinta en Needle Teal bajo el vértice de la V (`tests/icons/generate.py:28,87,287-292`). El papel tampoco es un solo tono: el tile es un degradado entre dos tonos de papel de Folio, `#F3ECDD` arriba y `#E7DFD0` abajo (`tests/icons/generate.py:68-69,79-80`); el `src-tauri/icons/icon.png` comprometido lo confirma (muestreado a 12% y 88% de la altura: 242,234,219 y 232,225,210). La marca dentro de la app (`VMark.svelte`) no dibuja el charco de tinta. Ejecutar `python3 tests/icons/generate.py` sin argumentos genera la variante invertida `ink`, papel sobre teal (`tests/icons/generate.py:358`). Dentro de la app la marca se pinta con `var(--accent)` (`src/lib/components/VMark.svelte:46-49`), así que en Folio sale en el verde de Folio.
- **Tamaños pequeños.** Por debajo de 64px el icono es la V sola (`tests/icons/generate.py:28-30`) y en la app por debajo de 40px (`src/lib/components/VMark.svelte:11-16`). No hay favicon: `src/index.html` no enlaza ningún icono.
