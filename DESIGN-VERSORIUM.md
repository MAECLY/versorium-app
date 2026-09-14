# VERSORIUM — Brand, tokens, themes, type

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
