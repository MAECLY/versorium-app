# PROMPT DE IMPLEMENTACIÓN — VERSORIUM

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
