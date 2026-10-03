# PROMPT DE IMPLEMENTACIÓN — VERSORIUM

> **Nota (2026-10-03).** Esta es la especificación original y su texto no se ha cambiado. La única adición es la «Enmienda (2026-10-03)» al principio de §11, una decisión del fundador sobre el token de updates; el texto original de §11 sigue debajo de ella. Lo que se entregó, y cómo se verificó, está en [`STATUS.md`](STATUS.md); el trabajo pendiente que se sigue de forma activa, en [`TODO.md`](TODO.md). `TODO.md` no es la lista completa: cada punto de esta especificación que no se construyó, o se construyó de otra forma, está anotado al final, en «Implementation notes (2026-10-03)», con la evidencia en el código.

Eres staff engineer + product designer. Implementa **Versorium**: aplicación de escritorio para novelistas. No es un chatbot con textarea. Es un estudio de manuscrito local-first que:

- detecta y usa las IAs que el usuario ya paga (CLI / Desktop / suscripción) o ya corre en local;
- expone un servidor MCP propio estilo Pencil/pen.dev;
- versiona el texto a granularidad de carácter con rollback;
- sincroniza la obra con Git/GitHub;
- se actualiza sola desde GitHub Releases.

Nombre de producto: **Versorium**  
CLI: `versorium`  
Id de app: `dev.versorium.app`  
Repo canónico de la app: **`github.com/maecly/versorium-app`** (org **maecly**, privado).  
Eso es el código de Versorium, no el repo de las novelas del usuario.  
Copyright y marca: fundador / maecly.  
Licencia de código: Apache-2.0 (lista para cuando se haga público; en privado el código es de maecly).  
Marca: `TRADEMARKS.md` — forks deben cambiar nombre y logo.

Si una decisión no está aquí, elige la opción más simple, local-first y reversible. No inventes SaaS, cuentas obligatorias ni markup de tokens.

---

## 0. Decisiones bloqueadas

1. Unidad default: **un archivo Markdown por capítulo**. Escenas = headings `##` dentro del capítulo. Split/merge de escenas existe como acción, no como default de disco.
2. Colaboración v1: **un autor + Git/GitHub**. Cero live multiplayer.
3. IA sobre texto en v1: solo opera sobre **selección** (rewrite / describe / shorten / change voice). **Modo Creativo** (generar o continuar capítulos enteros) = hueco de UI “Coming soon”, no implementar motor.
4. Settings → Safety → **Censorship ON/OFF** (global + override por provider).
5. Import/export de primer nivel, los 5 de industria: **Markdown, DOCX, EPUB 3, PDF, Scrivener (.scriv/.scrivx)**.
6. Soporte máximo de IAs: CLI/sub > local > BYOK. Grok por el puente que exista.
7. Local: **GGUF embebidos (low/mid/high)** + **Ollama** + LM Studio + llama.cpp.
8. Nombre: **Versorium**.
9. Gratis / open source. Fundador = copyright + trademark. Apache-2.0 + TRADEMARKS.md + CLA ligero para PRs.
10. UI y manuscrito v1: **English + Spanish**. Arquitectura i18n lista para más locales.
11. Releases de la **app**: GitHub Releases del repo privado `maecly/versorium-app`. Auto-update Win/Mac/Linux.
12. Firma de tienda Apple/Microsoft: no hay de momento. v1 = minisign/ed25519 + SHA256. Avisos Gatekeeper/SmartScreen documentados.
13. Org del producto: **maecly**. Repo **versorium-app**. Privado.
14. Dentro de la app, el usuario puede conectar **su** GitHub (cuenta personal y/o orgs). Versorium **detecta cuentas y orgs** (`/user`, `/user/orgs`) y el usuario **elige** dónde crear el remote de cada novela. No asumir maecly.
15. Git local siempre (libgit2). GitHub del **usuario** es opt-in. El repo `maecly/versorium-app` es SOLO el código de la app + updates + issues de crash. No se mezclan.
16. UI tipo **mini GitHub Desktop** dentro de Versorium: repos, private/public, orgs, commits, push/pull, branches. Recomendar instalar GitHub Desktop para power users; no es requisito.
17. Crash: **solo local**. Reportar = opt-in que abre issue en `maecly/versorium-app` con logs de la app. **Nunca** adjuntar texto de la novela.
18. Carpeta default: `Documents/Versorium/`.
19. MCP default **read**. Write = setting por cliente + warning. Todo write de agente pasa por git checkpoint ANTES y se etiqueta author=IA.
20. Portable/USB = next version, no v1.
21. Marca: ver nota legal abajo. Nombre Versorium se mantiene.

---

## 1. Promesa

Versorium es el estudio de novela que detecta Claude Code, Claude Desktop, Codex/ChatGPT, OpenCode y Grok, más Ollama y GGUF locales de low→high; los usa por suscripción, CLI o API; expone MCP para que esos agentes editen el manuscrito abierto; guarda historial de cada carácter; y se actualiza desde GitHub Releases.

---

## 2. Principios

1. Manuscrito = archivos humanos en disco (Markdown + YAML). Cero blob propietario.
2. No revendés tokens.
3. Nada sale a la nube salvo la acción concreta que el usuario disparó. Banner: “this call goes to X”.
4. IAs intercambiables por tarea.
5. MCP es host y servidor.
6. Undo de editor ≠ historial de obra. Ambos.
7. Auto-detectar lo instalado. Settings → Agents: Connected / Signed in / Detected CLI / Local online.
8. Updates firmados. Nunca ejecutar un binario de GitHub sin verificar firma.
9. Look: tokens y themes en `DESIGN-VERSORIUM.md`. Tres themes (Folio / Quarry / Needle). Tipografía: system UI + catálogo OFL descargable (mismo patrón que modelos). Acento de marca Needle Teal, no naranja iA ni lila Ulysses.

---

## 3. Stack (decidido)

| Capa | Elección |
|---|---|
| Shell | **Tauri 2** (Rust) |
| UI | Webview + frontend TypeScript (React o Svelte; una sola, no mezclar) |
| Editor | CodeMirror 6 o TipTap sobre Markdown fuente; fuente de verdad = `.md` en disco |
| DB local | SQLite (sqlx) para índice, ops log compactado, jobs, settings |
| Git | libgit2 (git2-rs) + GitHub CLI/API opcional |
| MCP | crate MCP stdio + HTTP/SSE local `127.0.0.1` |
| Local LLM | llama.cpp bindings **y** HTTP a Ollama `:11434` / LM Studio |
| Updater | plugin **Tauri updater** + endpoint generado desde GitHub Releases |
| CI | GitHub Actions: test, sign, publish release |
| Packaging | macOS `.dmg` + notarized `.app`; Windows `.msi` + `.exe` signed; Linux `.AppImage` + `.deb` |

Sin Electron. Sin cuenta. Sin telemetry default.

---

## 4. Layout de proyecto en disco

```
mi-novela/
  versorium.json
  manuscript/
    ch-01-title.md
    ch-02-title.md
  codex/
    characters/
    locations/
    factions/
    items/
    timeline.yml
  plot/
    outline.md
    beats.yml
  research/
  style/
    voice.md
  prompts/
  snapshots/
  .versorium/
    ops/          # character-level log (packs)
    embeddings/
    cache/
  .git/
```

`versorium.json` mínimo:

```json
{
  "schema": 1,
  "title": "",
  "language": "es",
  "uiLanguage": "es",
  "defaultChapterPattern": "ch-{n}-{slug}.md",
  "censorship": "off",
  "remote": null
}
```

Frontmatter de capítulo:

```yaml
---
id: ch-01
title: El despertar
status: draft
pov: null
words: 0
---
```

---

## 5. UI

Tres columnas + command palette (Ctrl/Cmd+K).

**Izquierda — Binder:** actos / capítulos / escenas; vistas Binder, corcho, outliner, timeline. Codex. Research. Indicadores Git + MCP + update.

**Centro — Editor:** Markdown WYSIWYM, typewriter, zen, focus. Split. Goals de palabras. Nombres del Codex clicables. Selección → Rewrite / Describe / Shorten / Voice (diff obligatorio antes de aplicar). Comentarios al margen.

**Derecha:** inspector de capítulo; chat de proyecto (contexto = capítulo abierto + fichas presentes + voice.md); historial; panel MCP; router de modelos.

**Inferior:** words, sesión, modelo, privacidad (Local / CLI / API), rama Git, dirty.

Idioma UI: `en` | `es` (sistema o setting). Independiente del idioma del manuscrito.

Modo Creativo: control visible, disabled, tooltip “v1.1”.

---

## 6. IAs — detección y routing

Al boot y en Settings → Agents, escanear PATH, app folders y puertos locales. Tarjetas con Re-check.

### 6.1 Harness de pago / CLI (prioridad)

| Target | Cómo |
|---|---|
| Claude Code | binario `claude`; reutilizar login Pro/Max |
| Claude Desktop | MCP host; no pedir API si Desktop ya autenticado |
| Codex CLI + ChatGPT desktop | `codex`; misma config |
| OpenCode | `opencode` |
| Gemini CLI | si existe |
| Grok / xAI | (1) CLI/Desktop oficial si existe (2) OpenCode modelo `grok-*` (3) API xAI BYOK (4) OpenRouter `x-ai/grok-*`. UI muestra el puente activo. No fingir login. |
| Copilot CLI | opcional |
| Cursor / VS Code / Windsurf | solo como clientes MCP externos |

Orden de invocación por acción: CLI harness → MCP write-back → API BYOK → local.

### 6.2 Local — catálogo nivel Meetily (obligatorio)

La referencia visual son las pantallas de Meetily: pestañas de motor, tarjetas con tamaño / calidad / velocidad, badges Balanced, Download, Ready, Selected. Versorium debe llegar a **ese nivel de soporte local**, aplicado a novela.

**Pestañas Settings → Local AI**

1. **Writing** — GGUF built-in (prosa, rewrite, continuity). Equivale a “Summary Model Configuration” de Meetily.
2. **Ollama** — daemon, `ollama list`, pull/delete en UI.
3. **Studio** — LM Studio y llama.cpp / llama-server (OpenAI-compatible).
4. **Dictation** — mismo patrón Whisper de Meetily (tiny → base → small → medium → large-v3 / turbo / q5). Dictar al capítulo activo. Si no entra en M4, el hueco de UI y el downloader compartido sí van en M4; los packs Whisper pueden activarse en M4.1.

**Catálogo built-in** en `models/catalog.json` (versionado; no hardcodear UI). Cada entry: id, family, label, task, tier, params, quant, sizeBytes, ramHintGB, ctx, speed, quality, badge, uncensored, sha256, url.

**Ladder Writing v1 (espejo Qwen/Gemma de Meetily):**

- LOW fast: Gemma 3 1B / Qwen 3.5 2B — tags, embeddings, outline crudo (~1 GB, ~1–2 GB RAM)
- MID balanced: Gemma 3 4B / Qwen 3.5 4B — rewrite de selección, sinopsis, chat corto (~2.3–2.6 GB, ~3.5 GB RAM, ctx 32k)
- MID+: Qwen 14B Q5 o similar — prosa local decente (~8–10 GB)
- HIGH: Gemma 27B / Qwen 32B Q4 solo si el wizard dice que cabe — prosa + censorship OFF
- Embeddings: pack chico fijo 30–100 MB, siempre local

Wizard de hardware preselecciona el pack más grande con 20% de margen. Nunca auto-descargar HIGH.

**UX de tarjeta (clonar Meetily):**

- Icono de peso (cohete / rayo / fuego) según speed
- Título + one-liner (velocidad • calidad)
- Badge `Balanced` / `Balanced+`
- Meta: size • quality • processing
- Derecha: Download | % + cancel | Ready (punto verde) | Selected
- Seleccionada: borde + fondo
- RAM hint, ctx, quant
- Censorship ON oculta o marca `uncensored`
- Delete con confirmación
- SHA256 post-download; fallo = borrar + error
- Cola de una descarga; resumible
- Path: Application Support/Versorium/models/ (equiv. Win/Linux). No git.

**Ollama tab:** Offline / Running; lista pulled; Pull por nombre + progress; hint de install y `OLLAMA_ORIGINS` si hace falta.

**Studio tab:** host/port, Test connection, guardar como `local-openai-compat`.

**Slots (como Transcript vs Summary en Meetily), no un modelo global:**

- Rewrite selección
- Chat de proyecto
- Continuity
- Embeddings
- Dictation

Cada slot = Built-in | Ollama | CLI harness | BYOK.

**Runtime:** llama.cpp embebido + GPU Metal/CUDA/Vulkan/CPU. Mostrar backend en Ready. Un inference pesado a la vez (no Large-v3 + 27B juntos sin aviso).

Censorship OFF → preferir GGUF/Ollama uncensored o Grok.  
Censorship ON → no sugerir uncensored.

### 6.3 Router por tarea (defaults, editables)

| Tarea | Default |
|---|---|
| Chat / plot holes | Claude Code o Grok |
| Rewrite selección | Claude o Grok |
| Continuity | Local MID o Claude |
| Embeddings / search | Local LOW |
| Outline barato | Local o DeepSeek BYOK |

### 6.4 Conectar MCP a clientes (estilo Pencil)

Settings → MCP toggles por cliente. Con permiso explícito, Versorium escribe la config nativa:

- Claude Code: `.mcp.json` / user scope
- Codex: `~/.codex/config.toml`
- OpenCode: `opencode.json`
- Claude Desktop: entrada stdio/HTTP local

Backup + rollback de esa config si falla. Auto-sync del puerto.

---

## 7. MCP server de Versorium

Mientras hay un proyecto abierto:

- `versorium mcp` stdio
- HTTP/SSE `127.0.0.1` opt-in
- scopes: `read` | `write` por cliente
- log de tools en el panel

Tools v1:

`get_app_state`, `list_projects`, `open_project`,  
`list_documents`, `read_document`, `write_document`,  
`insert_text`, `delete_text`, `replace_text`, `apply_edit_set`,  
`create_document`, `rename_document`, `move_document`,  
`codex_search`, `codex_get`, `codex_upsert`,  
`assemble_context`, `continuity_check`,  
`history_list`, `history_blame`, `rollback`, `diff`,  
`git_status`, `git_commit`, `git_log`, `git_push`, `git_pull`,  
`get_style`

Toda escritura de agente pasa por el mismo pipeline de ops que el teclado.  
Default MCP: **read**. Settings → MCP → Allow write (por cliente) con copy:
“Write lets the AI change your manuscript. Versorium will snapshot Git first. You can roll back. The model can still delete text if you allow the edit.”
Todo `insert/delete/replace/write_document` exige: (1) write enabled (2) preview diff (3) git checkpoint (4) op log con `author=ai:<client>`.
Delete de documento: confirmación extra.

---

## 8. Versionado

### Git embebido + GitHub del usuario (no de maecly)

Dos capas que no se mezclan:

| Qué | Dónde |
|---|---|
| Código de Versorium + updates | `maecly/versorium-app` (privado, org maecly) |
| Novela del usuario | carpeta local + git embebido + remote opcional en **su** cuenta u org |

**Motor local (siempre, aunque no haya Git instalado):** libgit2 dentro de Versorium. Crear proyecto = `init` + primer commit. Status, log, branch, commit, diff funcionan offline. No hay wizard “instala Git primero”.

**Binario `git` / `gh` en PATH:** opcional. Si existen, usarlos para credential helper y LFS. Si no, no bloquear.

**Panel Versioning (mini GitHub Desktop):**
- Dirty files, ahead/behind, commit, log, diff, branches
- Connect GitHub → user + orgs → crear remote **private por default** (Public solo con checkbox)
- Push / Pull / Fetch
- “Open in GitHub Desktop” si está instalado; si no, link oficial de descarga (recomendado, no requisito)
- Commits etiquetados: `human` vs `ai:<provider>` + trailer `Versorium-Agent: claude-code`

**Dos botones OAuth, no se mezclan:**
1. Updates → token solo `contents:read` de `maecly/versorium-app`
2. Novel GitHub → cuenta del escritor, scope `repo`

Nunca default remote a `maecly`. Nunca commitear keys, GGUF, cache, ni logs con prosa.

Checkpoint git **obligatorio** antes de MCP write; si falla el snapshot, no se aplica el write.

### Character-level ops

Cada insert/delete:

```
{ id, ts, author: "human"|"claude-code"|"ollama:qwen3:14b",
  docId, type, offset, text, prevId }
```

- Undo/redo ilimitado de sesión
- Scrubber de documento
- Rollback de carácter / palabra / frase / párrafo / capítulo
- Blame por span (humano vs modelo)
- Snapshots nombrados
- Compactación a packs; blame se conserva
- Merge Git: 3-way por documento; si no, rama `conflict-*` + UI por capítulo

---

## 9. Formatos (v1, los 5)

| Formato | Import | Export | Notas |
|---|---|---|---|
| Markdown | sí | sí | canónico |
| DOCX | sí (capítulos por Heading 1) | sí | Standard Manuscript Format: 12pt serif, double-space, 1" margins, header Apellido / Título / page |
| EPUB 3 | sí (best-effort) | sí | pasar epubcheck |
| PDF | no (no OCR de libro) | sí | print preview, chapter recto, running heads |
| Scrivener | sí Binder + textos + synopsis | sí | round-trip lo más fiel posible; documentar pérdidas |

---

## 10. i18n

- `locales/en/*.json`, `locales/es/*.json`
- ICU MessageFormat
- `ui.locale` ≠ `project.language`
- Quotes: EN curly; ES «» o “” + raya de diálogo —
- Word count locale-aware
- Hunspell `en_US` + `es_ES` + `es_419`
- Nuevo idioma futuro = folder + diccionario + quote map. Cero strings hardcodeadas en UI.

---

## 11. Updates (GitHub Releases) — requisito explícito

> **Enmienda (2026-10-03).** Decisión del fundador. A la pregunta «con el repo público, ¿las actualizaciones deberían funcionar sin token de GitHub?», respondió: «si correcto». El repo `MAECLY/versorium-app` se va a hacer público; el 2026-10-03 sigue privado y sin ninguna release. La regla queda así:
>
> - **Sin token de updater, la app sí comprueba**, de forma anónima: la petición no lleva cabecera `Authorization` (ni siquiera un `Bearer` vacío). Con el repo público, las releases y sus assets se leen sin login.
> - **El token `contents:read` pasa a ser opcional.** Si el escritor guardó uno, se sigue enviando igual que antes: es lo que permite leer las releases mientras el repo sea privado y lo que levanta el límite de GitHub para peticiones anónimas (60 por hora y por dirección IP). En Ajustes → Aplicación aparece como «Token de actualizaciones (opcional)», con una línea que dice para qué sirve.
> - **La seguridad no cambia.** Owner, repo y host (`api.github.com`) siguen compilados en el binario; minisign y `SHA256SUMS` se verifican igual con token o sin él, y no se instala nada si alguno no coincide. El token solo se envía a `api.github.com`: tampoco viaja cuando una descarga se redirige al almacenamiento de GitHub. El camino anónimo no se salta ninguna de estas comprobaciones.
> - **Cada respuesta de GitHub tiene su estado propio, con código y texto en inglés y en español:** 404 al buscar la release = todavía no hay ninguna versión publicada a la vista (no hay release, o el repo sigue privado y no hay token), como estado discreto y no como error; 403 con `x-ratelimit-remaining: 0`, o 429 = se alcanzó el límite anónimo, con la hora en que se restablece si GitHub la da y la indicación de que un token lo levanta; 401 con token = el token es incorrecto o fue revocado; sin red = silencio, como pide el punto 7 de «Cliente».
> - Dejan de aplicarse «Sin login no hay auto-update» y «Settings → Updates → Sign in» (punto 7 de «Publicación»), y del último párrafo de «Cliente» el «no chequear en loop» sin token y el badge «Sign in to get updates». «403/401 → re-login» queda así: un 401 con token pide cambiar u olvidar el token; un 403 por límite de peticiones no es un problema de token. Sigue sin haber comprobaciones en bucle: una al arrancar y otra por cada pulsación del botón.
>
> El texto original de §11 se conserva debajo, sin cambios, como registro histórico. Donde lo contradiga, manda esta enmienda.

### Publicación

Repo **privado** `maecly/versorium-app`. CI en tag `vX.Y.Z` (Actions de la org):

1. Build Win/Mac/Linux
2. Firmar **siempre** con minisign/ed25519 (clave privada en GitHub Actions secrets `VERSORIUM_MINISIGN_KEY`). Public key embebida en el cliente.
3. SHA256SUMS en el Release.
4. Adjuntar instaladores + `latest.json` (Tauri updater).
5. Release notes EN y ES.
6. **Cuando existan** Apple Developer ID + Windows Authenticode: añadirlos como paso extra, no reemplazar minisign.
7. Releases **privados**: token `contents:read` sobre `maecly/versorium-app` para el updater de la app (distinto del token que el usuario usa para *sus* novelas). Settings → Updates → Sign in. Sin login no hay auto-update.

Canales: `stable` (default) y `beta` (opt-in).

**UX de confianza sin certificado de tienda:**
- macOS: primer open = clic derecho → Open (Gatekeeper). El updater igual verifica minisign antes de reemplazar el .app.
- Windows: SmartScreen puede avisar; UI explica “maecly unsigned build”. Verificar hash en el diálogo de update.
- Linux AppImage: minisign + self-replace.

### Cliente

Al arrancar (y cada 12 h, y botón “Check for updates”):

1. GET del endpoint updater (GitHub Release latest o `latest.json` en el release).
2. Comparar semver.
3. Dialog nativo:
   - título, changelog (locale UI)
   - Download & Install / Later / Skip this version
4. Descargar a staging. Verificar **minisign + SHA256**. Rechazar si no coinciden. GitHub API con el token de keychain (repo privado).
5. Instalar:
   - **macOS:** reemplazo de `.app` estilo Sparkle; pedir permiso si hace falta; relanzar.
   - **Windows:** MSI/NSIS silent update + relanzar; si el antivirus bloquea, fallback “abrir instalador”.
   - **Linux:** AppImage self-replace si se corre el AppImage; si es `.deb`, descargar y `xdg-open` el paquete o mostrar instrucción apt. No romper installs de distro packager sin avisar.
6. No actualizar si el usuario está en medio de un write sucio: guardar, luego update.
7. Offline: no molestar. Error de red: silencio o badge, no modal cada hora.
8. Setting: “Automatic updates” ON por default en stable.

No usar un servidor propio. Fuente = GitHub Releases privados de `maecly/versorium-app`. Sin token de updater → no chequear en loop; badge “Sign in to get updates”. 403/401 → re-login. Backoff en red.

---

## 12. Privacidad

- Local-first
- Keys en OS keychain
- MCP solo localhost default
- Airplane mode = solo GGUF/Ollama
- Telemetry OFF. Crash files solo en disco (`logs/crash-*.json`: stack, OS, versión app). Cero prosa.
- Report crash: opt-in. Abre el browser en `github.com/maecly/versorium-app/issues/new` con plantilla + log adjunto que el usuario puede recortar. Sin consent = no red.
- Pantalla “qué se envió” por call cloud
- Cifrado de carpeta de proyecto opcional (password)

---

## 13. CLI

```
versorium new "Title"
versorium open ./book
versorium mcp
versorium status
versorium commit -m "..."
versorium rollback --doc ch-01 --to op:<id>
versorium export --format docx|epub|pdf|md|scriv
versorium update
```

---

## 14. Onboarding

1. Hardware wizard → recomienda pack LOW/MID/HIGH.
2. Detect CLIs → “Connect what I found”.
3. Crear/abrir carpeta → git init.
4. Plantilla: blank / three-act / Save the Cat / Kishōtenketsu.
5. Primera escena. Atajo selección → Rewrite.
6. Check for updates en silencio la primera vez (no robar el tour).

Sin signup.

---

## 15. Fuera de v1

Modo Creativo motor, live collab, marketplace, portada, audiolibro, más idiomas de UI, plugin store.

---

## 16. MVP cortado (ship this first)

**M0 — skeleton:** Tauri app, binder, editor MD, guardar, i18n en/es, settings vacíos.  
**M1 — git + ops:** historial carácter, rollback palabra, commit, GitHub remote.  
**M2 — agents detect:** Claude Code, Codex, OpenCode, Ollama; router; rewrite selección + diff.  
**M3 — MCP:** server + auto-write configs + assemble_context.  
**M4 — local packs nivel Meetily:** catálogo en tarjetas, Download/Ready/Selected, GGUF Writing ladder, Ollama tab, censorship toggle, wizard hardware. Dictation Whisper usa el mismo downloader.  
**M5 — formats:** DOCX, EPUB, PDF, Scrivener import.  
**M6 — updater:** GitHub Releases signed en 3 OS.  
**M7 — polish:** corkboard, continuity check básico, onboarding.

No saltar M1 ni M6. Sin historial y sin update, no es Versorium.

---

## 17. Criterios de aceptación

- Máquina con Claude Code + Ollama: Settings los marca Connected sin pegar keys.
- OpenCode reemplaza un párrafo vía MCP; el timeline enseña `author=opencode`; rollback de esa palabra funciona.
- Capítulo 4k palabras + 200 edits humanos + 30 de IA: rewind a cualquier palabra del doc activo < 100 ms.
- Clone GitHub en otro PC reconstruye el manuscrito; ops van en packs commiteables o snapshots.
- Offline total con un GGUF MID.
- Publicar tag `v0.1.0` en GitHub → las 3 apps detectan update, verifican firma, instalan, relanzan.
- DOCX export abre en Word y cumple manuscript format básico.
- UI completa en EN y ES.

---

## 18. Lo que debes producir ahora (en este orden)

1. Arquitectura de crates/módulos Versorium (diagrama textual).
2. Schema final de `versorium.json`, frontmatter, op, `latest.json` del updater.
3. Lista de binarios a detectar por OS (paths típicos Win/Mac/Linux).
4. Wireframes textuales: Editor, Agents, MCP, History, Settings, Update dialog.
5. Plan de CI: jobs, secrets de signing, artefactos del Release.
6. Riesgos y mitigaciones (harnesses que cambian flags, Scrivener reverse-engineer, code signing cost).

Después de eso, código del M0.

No uses el nombre QuillForge ni PlotForge. El producto se llama **Versorium**.

---

## Implementation notes (2026-10-03)

Estado de la rama `feat/landing-and-docs`, cortada de `main` justo después del merge del PR #9. Cada entrada dice qué pide la especificación, qué hace el código y dónde comprobarlo. Si el código o la documentación registran el motivo, se cita; si no, se dice que no consta. Lo que coincide con la especificación no se lista. Nada de lo anterior se ha cambiado para que encaje con el código.

### Cabecera y §0 — decisiones

- **Repo privado (§0.11, §0.13, §11).** Hoy `MAECLY/versorium-app` sigue siendo privado, como pide la spec; las constantes compiladas usan esa grafía (`src-tauri/src/update/mod.rs:31-32`, `src-tauri/src/crash/mod.rs:23-24`). `TODO.md` («Going public») prevé hacerlo público: la org MAECLY está en el plan gratuito de GitHub, donde Pages no sirve repos privados, y los assets de una release privada no los puede descargar quien llegue desde la página `versorium.maecly.com`. Todavía no se ha hecho.
- **CLA ligero para PRs (§0.9).** No hay CLA ni `CONTRIBUTING` en el repo. No consta el motivo.
- **Split/merge de escenas como acción (§0.1).** No existe. Los comandos de capítulo son crear, listar, leer, guardar, actualizar, reordenar y borrar (`src-tauri/src/commands/chapters.rs`, `src-tauri/src/commands/project.rs:239-267`). No consta el motivo.
- **Censorship ON/OFF global + override por provider (§0.4).** Es un único booleano global (`src-tauri/src/commands/settings.rs:85`), sin override por proveedor. Está en Settings → Local AI, no en una sección Safety, porque filtra una lista de modelos (`src/lib/settings/groups/LocalAiGroup.svelte:30-32`). Solo oculta las entradas `uncensored` del catálogo (`src/lib/models/state.svelte.ts:33-36`); no cambia qué proveedor se usa (§6.2, «Censorship OFF → preferir GGUF/Ollama uncensored o Grok»). El campo `censorship` de `versorium.json` se escribe como `"off"` al crear el proyecto (`src-tauri/src/commands/project.rs:180`) y nada lo lee.

### §2 y §3 — principios y stack

- **SQLite (sqlx).** No se usa SQLite: no hay `sqlx` ni ninguna base de datos en `src-tauri/Cargo.toml`. Los settings son un `settings.json` en el directorio de datos de la app (`src-tauri/src/paths.rs:30`); el log de ops es JSONL por capítulo (`src-tauri/src/ops/mod.rs:1-6`). No hay índice ni cola de jobs persistente. No consta el motivo.
- **LM Studio / llama-server por HTTP.** La pestaña Studio prueba la conexión y guarda host y puerto (`src-tauri/src/commands/models.rs:228-262`), pero ningún slot puede usarlo: los tipos de slot son `none | builtin | ollama | cli` (`src-tauri/src/commands/settings.rs:38`). Se guarda como `studioHost`/`studioPort`/`studioEnabled`, no como `local-openai-compat`.
- **Packaging firmado.** Ni `.app` notarizado ni `.exe`/`.msi` con Authenticode: ambos requieren certificados de pago (`TODO.md`, «Going public»). El workflow de release está preparado para firmar las builds con minisign/ed25519 y publicar `SHA256SUMS` (`.github/workflows/release.yml:189-190`), pero todavía no se ha firmado ninguna: no hay tag ni release, y los dos secretos de firma no están configurados (véase §11 abajo).
- **Tipografía (§2.9).** El catálogo solo ofrece fuentes ya instaladas en la máquina; no hay descarga de fuentes OFL. Source Serif 4 aparece como no disponible en vez de ofrecerse con una URL que no se puede cumplir (`fonts/catalog.json:3`).

### §4 — layout en disco

- Se crean todas las carpetas (`src-tauri/src/commands/project.rs:156-172`) y `codex/timeline.yml`, `plot/outline.md` y `style/voice.md` (`project.rs:198-204`). **`plot/beats.yml` no se crea.**
- Los snapshots del log de ops van a `.versorium/snapshots/<capítulo>/<seq>.md` (`src-tauri/src/ops/mod.rs:6`), no a la carpeta `snapshots/` de la raíz, que se crea vacía.
- `versorium.json` lleva además `author`, `chapterOrder`, `exportCover` y `exportColophon` (`project.rs:12-52`). `chapterOrder` existe porque reordenar renombrando archivos dejaría huérfano el historial de ops de cada capítulo movido (`project.rs:25-35`).
- `uiLanguage` se escribe siempre como `"en"` (`project.rs:178`) y la UI no lo lee; el idioma de la UI sale de `uiLocale` en los settings de la app.

### §5 — UI

- **No hay command palette** (Ctrl/Cmd+K).
- **Binder:** solo novelas y capítulos (`src/lib/binder/ChapterList.svelte`). No hay actos ni escenas, ni vistas outliner o timeline. Codex y Research no tienen UI. El Codex se lee y escribe por MCP (`src-tauri/src/mcp/tools.rs:128-131`, `:152`), y además el chequeo de continuidad lo lee y envía al modelo extractos de hasta 40 entradas (`src-tauri/src/continuity/mod.rs:21-24`, `:75-82`). El corcho sí existe (`src/lib/binder/Corkboard.svelte`).
- **Indicadores Git + MCP + update en el Binder:** no hay ninguno en el Binder ni en la barra superior (`src/lib/binder/ChapterList.svelte`, `src/lib/components/TopBar.svelte`). El estado Git está en la barra inferior (`src/lib/components/StatusBar.svelte:69-72`). No hay indicador de MCP ni de updates fuera de Settings; lo único es el diálogo de update, que solo aparece cuando hay una versión disponible (`src/App.svelte:312`). No consta el motivo.
- **Modo Creativo:** el botón está visible y deshabilitado, sin motor, con el tooltip «Creative mode is coming. It is not available yet.» / «El modo creativo llegará. Todavía no está disponible.» (`src/lib/components/TopBar.svelte:61`, `locales/en/ui.json:289`, `locales/es/ui.json:289`). §5 pide un tooltip «v1.1» y §0.3 habla de un hueco «Coming soon»; las dos formulaciones de la spec no coinciden. El texto de la UI está más cerca de §0.3 y no promete ninguna versión; queda a decisión del mantenedor si debe nombrar una.
- **Editor:** focus y typewriter sí (`src/lib/editor/modes.ts`). No hay modo zen aparte, split, goals de palabras, nombres del Codex clicables ni comentarios al margen.
- **Acciones sobre la selección:** solo Rewrite, con un único prompt (`src-tauri/src/agents/mod.rs:380-390`). No hay Describe, Shorten ni Voice. El diff antes de aplicar sí es obligatorio (`src/lib/components/RewriteDialog.svelte:186`).
- **Columna derecha:** no es una columna fija. El panel de historial se abre a la derecha cuando se pide (`src/App.svelte:270`). No hay chat de proyecto (`TODO.md`, «Specified, not started»). Tampoco hay inspector de capítulo; `TODO.md` no lo menciona y no consta el motivo. El log de MCP y los slots de modelo están en la página de Settings.
- **Barra inferior:** palabras, estado de guardado, estado Git y los controles de vista (`src/lib/components/StatusBar.svelte:51-111`). No muestra sesión, modelo, privacidad (Local / CLI / API) ni rama; la rama está en la pestaña avanzada del panel de historial (`src/lib/components/GitPanel.svelte:207-211`).
- **Idioma de la UI «sistema o setting»:** solo setting, por defecto `en` (`src-tauri/src/commands/settings.rs:199`); no se detecta el idioma del sistema (`src/lib/i18n/state.svelte.ts:63-75`).

### §6 — IAs

- **Detección:** binarios `claude`, `codex`, `opencode`, `ollama` y `gh` (`src-tauri/src/agents/mod.rs:202-209`). No se detectan Claude Desktop ni ChatGPT desktop como harness, ni Gemini CLI, Grok/xAI (ningún puente), ni Copilot CLI. Claude Desktop sí es uno de los cuatro clientes MCP cuya configuración se escribe (`src-tauri/src/mcp/clients.rs:37-42`).
- **BYOK:** no existe. No hay claves de API ni proveedores en la nube por HTTP; los slots solo aceptan `none | builtin | ollama | cli` (`src-tauri/src/commands/settings.rs:38`).
- **Orden de invocación CLI → MCP → BYOK → local:** no hay cadena de respaldo. Cada slot nombra un modelo concreto y se usa ese, o falla con un código de error (`src-tauri/src/agents/mod.rs:407-420`). Motivo: un nombre de proveedor no dice qué modelo eligió el escritor (`agents/mod.rs:404-406`).
- **Router por tarea (§6.3):** no hay defaults; todos los slots empiezan sin asignar (`src-tauri/src/commands/settings.rs:17-22`).
- **Slots sin superficie:** Rewrite y Continuity funcionan. Chat, Embeddings y Dictation se pueden asignar, pero nada los usa, y no hay pack Whisper en `models/catalog.json` (`TODO.md`, «Specified, not started»).
- **Ladder de modelos:** las familias no son las de la spec. `models/catalog.json` tiene 12 entradas: Qwen3.5, Llama 3.2, SmolLM2, Qwen3, Gemma 4 y Qwen 3.8, más nomic-embed-text v1.5 (84 MB) para embeddings. HIGH es Qwen 3.8 27B, no Gemma 27B / Qwen 32B. Motivo en `STATUS.md` («Catalogue provenance»): los modelos de ejemplo de la spec están una generación atrás.
- **Runtime GPU:** llama.cpp en proceso (`llama-cpp-2`, fijado a `=0.1.157`). Metal en macOS, Vulkan en Windows y Linux (feature `vulkan`, solo en la build de release) y CPU. **Sin CUDA**, a propósito: necesitaría el toolkit completo en cada runner y ~390 MB de redistribuibles para hardware que Vulkan ya cubre (`src-tauri/Cargo.toml:65-76`).
- **Ruta de modelos:** `<data dir>/dev.versorium.app/models` (`src-tauri/src/models/store.rs:43-44`, `src-tauri/src/paths.rs:18-24`); en macOS, `Application Support/dev.versorium.app/models/`, no `Application Support/Versorium/models/`.

### §7 — MCP

- **Tools:** hay 23 (`src-tauri/src/mcp/tools.rs:109-159`). Faltan `apply_edit_set`, `rename_document`, `move_document`, `continuity_check`, `rollback`, `git_push` y `git_pull`. Se añadieron `search` y `delete_document`.
- **Preview diff obligatorio y confirmación extra al borrar (§7):** no se cumplen como los pide la spec. El preview solo se devuelve cuando el agente omite `confirm` (`src-tauri/src/mcp/write.rs:3-4`, `:162-163`); un agente que manda `confirm: true` en la primera llamada aplica la escritura sin preview, y el escritor no ve ningún diff (el test `a_confirmed_write_checkpoints_first_then_records_agent_ops`, `write.rs:403-410`, aplica una escritura así sin llamada previa). En `delete_document`, `acknowledge_delete` es también un argumento que pone el propio agente (`write.rs:312`), no una confirmación del escritor. Lo que sí se cumple: permiso de escritura activado, checkpoint Git antes de aplicar y op log con `author=ai:<cliente>`. No consta el motivo.
- **Transporte HTTP:** es Streamable HTTP en `127.0.0.1`, opt-in, con un bearer token por arranque; no HTTP/SSE. Motivo: el transporte HTTP+SSE está deprecado en la especificación de MCP (`src-tauri/src/mcp/http.rs:3-10`).

### §8 — versionado

- **«Dos botones OAuth»:** no hay OAuth. Son dos tokens personales de GitHub que se pegan a mano (`locales/en/ui.json:165`), guardados por separado en el almacén de credenciales del sistema (`src-tauri/src/secrets/mod.rs`). La separación entre el token de updates y el de la novela sí se mantiene.
- **Remote privado por defecto, Public con checkbox:** siempre privado; no hay casilla Public (`src-tauri/src/commands/git.rs:79-83`).
- **Push / Pull / Fetch:** Push y Pull existen, en Settings → copia de seguridad (`src/lib/settings/groups/BackupGroup.svelte:156-159`); no hay botón Fetch aparte. Pull solo avanza en fast-forward y se niega con `git_diverged` si las historias divergen: no hay merge a tres vías ni rama `conflict-*`. Motivo: un merge real puede tener conflictos, y resolverlos dentro de un editor de novelas es una función propia; hasta que exista, negarse con `git_diverged` sin tocar el trabajo es el resultado honesto (`src-tauri/src/git/repo.rs:368-373`).
- **«Open in GitHub Desktop»:** no existe, ni el enlace de descarga.
- **Commits etiquetados `human` vs `ai:<provider>` + trailer `Versorium-Agent:`:** todos los commits llevan la firma de la app (`src-tauri/src/git/repo.rs:14-16`) y no hay trailer. El origen consta en el mensaje del checkpoint previo — `checkpoint: before mcp <tool> (<client>)` (`src-tauri/src/mcp/write.rs:74-75`) y `checkpoint: before ai rewrite (<provider>)` (`src-tauri/src/commands/ai.rs:89-91`) — y en el log de ops.
- **Forma del op:** los campos son `seq, ts, author, kind, from, to, text` (`src-tauri/src/ops/mod.rs:19-30`); no hay `id`, `docId` ni `prevId` (el capítulo es la carpeta del pack). `author` vale `human` o `ai:<cliente>`, no `claude-code` u `ollama:qwen3:14b` a secas.
- **Compactación a packs:** no hay compactación. Hay un JSONL por capítulo y día, y un snapshot del capítulo cada 200 ops (`src-tauri/src/ops/mod.rs:1-6`, `:16`).
- **Rollback, scrubber y blame:** el rollback deshace la última edición de la sesión dentro de la palabra bajo el cursor o de la selección (`src/lib/git/rollback.ts`, `src/App.svelte:151`). No hay scrubber de documento ni rollback por frase, párrafo o capítulo como acción propia; restaurar un archivo desde un commit sí (`src-tauri/src/commands/git.rs:53`). El blame por span solo existe por MCP (`history_blame`, `src-tauri/src/mcp/tools.rs:122`); no hay vista en la UI.
- **Undo ilimitado de sesión:** se usa `history()` de CodeMirror con sus valores por defecto (`src/lib/editor/cm.ts:25`); no está configurado como ilimitado.

### §9 — formatos

- Los cinco formatos exportan (`src-tauri/src/commands/formats.rs:62-73`). Importan Markdown, DOCX, Scrivener y EPUB (`formats.rs:89-92`); PDF no, como pide la spec.
- **PDF «chapter recto»:** cada capítulo empieza en página nueva (`src-tauri/src/formats/pdf.rs:183`), no necesariamente en página impar.

### §10 — i18n

- **ICU MessageFormat:** no se usa. La interpolación es una sustitución simple de `{clave}` (`src/lib/i18n/state.svelte.ts:22-25`), sin plurales.
- **Comillas por idioma** y **diccionarios Hunspell** (`en_US`, `es_ES`, `es_419`): no implementados.
- **Conteo de palabras según el idioma:** cuenta tramos separados por espacios en blanco, igual en todos los idiomas (`src-tauri/src/commands/project.rs:336-340`).

### §11 — updates

- **Nombre del secreto:** el workflow usa `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, no `VERSORIUM_MINISIGN_KEY`, porque es el nombre que lee la build de Tauri (`RELEASING.md`, sección sobre el nombre del secreto; `.github/workflows/release.yml:189-190`). Ninguno de los dos está configurado todavía en GitHub.
- **Ninguna release publicada:** no existe ningún tag ni release. El workflow crea la release como borrador para que una persona revise `latest.json` y `SHA256SUMS` antes de ofrecérsela a ningún cliente (`.github/workflows/release.yml:248`).
- **macOS, «clic derecho → Open»:** ya no funciona. En el macOS actual, un paquete en cuarentena sin firma Developer ID se presenta como dañado y el clic derecho no lo salta. El cuerpo de la release, en inglés y español, indica quitar la marca de cuarentena con `xattr -rd com.apple.quarantine /Applications/Versorium.app` y hacerlo solo con una copia descargada de la página de releases (`.github/workflows/release.yml:194-208`).
- **Windows / SmartScreen:** el cuerpo de la release explica la pantalla azul de SmartScreen y el paso More info → Run anyway (`.github/workflows/release.yml:214-218`). En la app el aviso es genérico (`locales/en/ui.json:579`): no dice «maecly unsigned build» y el diálogo de update no muestra el hash; dice que firma y checksum se comprueban antes de instalar (`locales/en/ui.json:588`).
- **Cada 12 h:** no. La comprobación automática es una sola, al arrancar (`src/lib/update/state.svelte.ts:99-110`, `locales/en/ui.json:571`). El botón de comprobar a mano sí existe.
- **«No actualizar en medio de un write sucio: guardar, luego update»:** no hay paso explícito de guardar antes de instalar (`src/lib/update/state.svelte.ts:54-61`).
- **Linux `.deb`:** no hay código propio para descargar el paquete y abrirlo con `xdg-open`; la instalación la hace el plugin updater de Tauri. Qué hace el plugin con una instalación `.deb` no está verificado.
- **Token opcional (enmienda de 2026-10-03):** el código ya sigue la enmienda. Sin token, `update_check` y `update_install` preguntan de forma anónima (`src-tauri/src/commands/update.rs`), y `request_headers` solo añade `Authorization` cuando hay un token guardado (`src-tauri/src/update/mod.rs`). Las respuestas de GitHub se traducen en `classify`, en el mismo archivo. Mientras el repo siga privado, una comprobación sin token recibe un 404, y Ajustes → Aplicación muestra que no hay ninguna versión publicada a la vista. El camino anónimo no se ha probado todavía contra el repo público, porque aún no lo es.
- **Badge «Sign in to get updates»:** la enmienda lo retira y no existe en el código. Ya no hay ningún aviso de «iniciar sesión»: el botón de comprobar no depende del token (`src/lib/settings/UpdatesSection.svelte`), y el campo del token se presenta como opcional (`src/lib/settings/groups/AppGroup.svelte`, claves `git.updatesSlot` y `git.updatesSlotHint` de `locales/es/ui.json`).

### §12 — privacidad

- **Modo avión**, **pantalla de «qué se envió» por llamada a la nube** y **cifrado opcional de la carpeta del proyecto:** no existen. Sí existe el aviso previo «this call goes to X» antes de reescribir (`src/lib/components/RewriteDialog.svelte:169`).

### §13 — CLI

- Solo existe `versorium mcp [--client <id>]` (`src-tauri/src/mcp/mod.rs:36-61`). `new`, `open`, `status`, `commit`, `rollback`, `export` y `update` no existen.

### §17 — criterios de aceptación

- **Publicar `v0.1.0` y que las tres plataformas detecten, verifiquen, instalen y relancen:** sin probar; no hay ningún tag ni release.
- **Timeline con `author=opencode`:** el log de ops registra `ai:opencode` (`src-tauri/src/mcp/write.rs:170`).
- **Rewind en menos de 100 ms** (4k palabras, 230 edits), **clone en otro PC**, **offline total con un GGUF MID** y **DOCX abierto en Word:** no consta ninguna medición ni prueba de aceptación de estos criterios en el repo.
