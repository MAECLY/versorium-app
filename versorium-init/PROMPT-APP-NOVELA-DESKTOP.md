# PROMPT DE PRODUCTO — Desktop Novel Studio (nombre TBD; NO usar QuillForge)

Eres un product designer + staff engineer. Diseña y especifica una **aplicación de escritorio nativa** para escritores de novelas y sagas. No es un chatbot con un textarea. Es un estudio de manuscrito que se conecta a las IAs que el usuario YA paga o YA corre en local, expone MCP como Pencil/pen.dev, y versiona el texto a granularidad de carácter.

## Decisiones de producto BLOQUEADAS (2026-09-11)

1. Unidad default: **un archivo Markdown por capítulo**. Escenas viven dentro del capítulo (headings `##`). Split/merge de escenas es feature, no default.
2. Colaboración v1: **solo autor + Git/GitHub**. Sin live multiplayer.
3. IA sobre texto: **reescribe la selección**. El modo que genera/continúa a lo grande se llama **Modo Creativo** y queda **fuera de v1** (diseñar el hueco en UI, no implementarlo).
4. Settings: **toggle Censura ON/OFF** (global + override por provider). OFF = preferir rutas local HIGH / uncensored / providers sin filtro. ON = providers filtrados permitidos.
5. Intercambio de archivos — top 5 de la industria, import + export de primer nivel:
   - **DOCX** (envío a agentes/editores; Standard Manuscript Format)
   - **EPUB 3** (tiendas ebook / KDP)
   - **PDF** (prueba impresa / beta)
   - **Markdown** (fuente canónica del proyecto)
   - **Scrivener (.scriv / .scrivx)** (WIP de la industria; import fiel del Binder + compile-ready export lo más fiel posible)
6. Máximo soporte de IAs: detectar y usar **subs/CLI primero**, luego local, luego BYOK. Ver §5 ampliado.
7. Local: **las dos**. Gestor de **GGUF embebidos** (descarga verificada low/mid/high) **y** conexión a **Ollama** (y LM Studio / llama.cpp).
8. Nombre: no fijar QuillForge (ya existe un producto). Elegir de la lista de 20 del briefing.
9. Licencia: **gratis y open source**, el fundador **conserva copyright y marca**. Código Apache-2.0 (o MIT) + archivo TRADEMARKS.md: el nombre y logos no se pueden usar para forks que se hagan pasar por el original. CLA simple para PRs.
10. Idiomas v1: **UI + escritura = English y Spanish only**. i18n architecture (locales/, ICU, date/number/quotes) lista para añadir idiomas después sin rewrite.

Plataformas: Windows 10/11, macOS 13+, Linux (AppImage + .deb). Misma codebase.
Stack preferido: Tauri 2 + Rust core + editor web embebido. Offline-first. Sin cuenta obligatoria.

---

## 1. Promesa en una frase

La app es el estudio de novela que detecta Claude Code, Claude Desktop, Codex/ChatGPT, OpenCode, Grok y tus modelos locales (Ollama + GGUF embebidos low→high, LM Studio, llama.cpp), te deja usarlos por **suscripción, CLI o API**, expone un **MCP propio** para que esos agentes editen el manuscrito abierto, y guarda **historial de cada carácter** con rollback instantáneo + Git/GitHub.

---

## 2. Principios no negociables

1. El manuscrito vive en disco del usuario, en archivos humanos (Markdown + sidecar YAML/JSON). Nunca como blob propietario opaco.
2. La app NO revendé tokens. No markup. BYOK / BYO-CLI / local.
3. Nada sale a la nube salvo que el usuario elija un provider cloud para ESA acción. Banner visible: “esta llamada sale a X”.
4. Las IAs son intercambiables por tarea: planificar con modelo barato/local, prosa con Claude/Grok, revisión con otro.
5. MCP es ciudadano de primera: la app es host Y servidor.
6. Versionado a nivel de carácter. Undo de editor ≠ historial de obra. Ambos existen.
7. Detectar lo instalado. Cero fricción tipo Pencil: Settings → Agents muestra Connected / Signed in / Detected CLI / Local online.

---

## 3. Modelo de proyecto en disco

Un proyecto de novela es una carpeta Git:

```
mi-novela/
  project.json             # meta del proyecto (locale, title, format prefs)
  manuscript/
    ch-01-el-despertar.md  # DEFAULT: un archivo por capítulo
    ch-02-...
  codex/
    characters/
    locations/
    factions/
    items/
    timeline.yml
    themes.yml
  plot/
    outline.md
    beats.yml
    story-grid.yml
  research/
  style/
    voice.md
    do-not.md
  prompts/
  snapshots/               # snapshots locales nombrados
  .quillforge/
    crdt/                  # ops de carácter (ver §7)
    embeddings/
    cache/
  .git/
  README.md
```

Formato de capítulo: Markdown + frontmatter (id, título, POV, escena, estado draft/revise/done, wordcount).
Export: MD, DOCX, EPUB, PDF, Fountain (opcional), texto plano.

---

## 4. UI — layout del estudio

Tres columnas redimensionables + paleta de comandos (Ctrl/Cmd+K).

**Izquierda — Binder**
- Árbol: Actos → Capítulos → Escenas
- Vistas: Binder / Corcho (index cards) / Outliner / Timeline / Story Grid
- Codex: personajes, lugares, objetos, reglas del mundo
- Research + notas
- Indicador de sync Git y de MCP clients conectados

**Centro — Editor**
- Modo WYSIWYM markdown con typewriter, focus, zen, vanishing ink
- Split view: escena vs nota / escena vs capítulo anterior / escena vs ficha de personaje
- Goals de palabras por sesión/capítulo/libro
- Highlight de nombres del Codex (click abre ficha)
- Inline AI: selección → Reescribir / Continuar / Describir / Dialogar / Acortar / Cambiar voz
- Diff de cada sugerencia de IA ANTES de aplicar
- Comentarios tipo margen

**Derecha — contextual, pestañas**
- Inspector de escena (POV, lugar, hora, personajes presentes, objetivo, conflicto)
- Chat/agente anclado al proyecto (conoce Codex + capítulo abierto)
- Historial de versiones (timeline de commits + ops de carácter)
- Panel MCP: quién está conectado, últimas tools llamadas
- Router de modelos: “esta acción usa ___”

Barra inferior: words, sesión, modelo activo, privacidad (Local / CLI-sub / API), rama Git, dirty state.

---

## 5. Capa de IAs — detección y routing (el corazón, estilo Pencil + Meetily)

### 5.1 Auto-detección al arrancar y al abrir Settings → Agents

Escanear el sistema y mostrar tarjetas con estado:

**Harness / suscripción / CLI (prioridad alta, usar la sub del usuario):**
- Claude Code CLI (`claude`) — login Pro/Max existente
- Claude Desktop (MCP host)
- OpenAI Codex CLI (`codex`) + ChatGPT desktop (misma config Codex)
- OpenCode CLI
- Gemini CLI (si existe)
- Grok / xAI — máxima cobertura, en este orden: (1) CLI o Desktop oficial si existe (2) OpenCode con modelo grok-* (3) API xAI BYOK (4) OpenRouter x-ai/grok-*. La UI muestra cuál puente está activo. Nunca fingir un login inexistente.
- GitHub Copilot CLI (opcional)
- Cursor / VS Code / Windsurf solo como hosts MCP externos, no como dependencia

**Local tipo Meetily (low → high, pluggable):**
- Ollama (listar modelos pulled, health de localhost:11434)
- LM Studio (server local)
- llama.cpp / llama-server
- vLLM / cualquier endpoint OpenAI-compatible en LAN
- Runtime embebido opcional (GGUF bundled o descargable): 
  - LOW: 1–4B (Phi / Gemma tiny) para tags, outline crudo, clasificación, embeddings
  - MID: 7–14B para brainstorm, continuity check barato, sinopsis
  - HIGH: 27–70B si el hardware aguanta (Gemma 27B, Qwen 32B, Llama 70B Q4) para prosa local
- GPU: CUDA / Metal / Vulkan / CPU fallback. Wizard de hardware: “tu máquina aguanta X”.
- Model pack manager: descargar, verificar hash, borrar, pin por tarea.

**API / BYOK (opcional, nunca obligatorio):**
- OpenAI, Anthropic, Google, xAI/Grok, DeepSeek, Mistral, Groq, OpenRouter, Azure, custom baseURL.

Cada tarjeta: Detected / Signed in / API key / Offline / Missing.
Botón “Re-check connection” como Pencil.
Nunca pedir API key si el CLI ya está logueado.

### 5.2 Router de tareas

El usuario asigna un modelo DEFAULT por tipo de trabajo, con override por acción:

| Tarea | Default sugerido |
|---|---|
| Chat de proyecto / plot holes | Claude Code o Grok (sub) |
| Prosa / continuar escena | Claude o Grok high |
| Reescritura estilística | Claude |
| Continuity / contradicciones | Local MID o Claude |
| Tags, embeddings, búsqueda semántica | Local LOW embebido |
| Outline masivo barato | Local o DeepSeek |
| Censorship-sensitive fiction | Local HIGH o Novel-friendly endpoint |

Smart routing opcional: “usa local si el prompt < N tokens y no pide prosa literaria”.

### 5.3 Cómo se invocan (orden de preferencia)

1. **CLI harness** del vendor (Claude Code, Codex, OpenCode) vía stdio/RPC — consume la suscripción.
2. **MCP hacia afuera**: la app es servidor; el CLI es cliente y edita el doc abierto.
3. **SDK / API** si el usuario pegó key.
4. **Local** Ollama / LM Studio / embebido.

Integración estilo Pencil:
- Settings → MCP: toggles por cliente (Claude Code, Codex, OpenCode, Claude Desktop, ChatGPT desktop).
- Al activar, la app escribe/actualiza la config nativa de ese cliente (`.mcp.json`, `~/.claude.json` fragment, `opencode.json`, `~/.codex/config.toml`) SOLO con permiso explícito, con backup y rollback de config.
- Auto-sync del puerto MCP si cambia.

---

## 6. MCP server propio (igual de ambicioso que Pencil, dominio novela)

Cuando QuillForge está abierto con un proyecto, levanta:

- MCP stdio (para CLIs)
- MCP HTTP/SSE local opt-in `127.0.0.1` (para Desktop apps)
- CLI `quill` / `quillforge` para headless

### Tools MCP (mínimo viable rico)

**Estado**
- `get_app_state` — proyecto abierto, capítulo activo, selección, rama git, dirty, modelo router
- `list_projects` / `open_project`

**Manuscrito**
- `list_documents` — binder
- `read_document` — por id, con rango de líneas o offset de caracteres
- `write_document` — replace rango (character offsets) con preview/diff
- `insert_text` / `delete_text` / `replace_text` — offsets UTF-8
- `apply_edit_set` — batch atómico con una sola entrada de historial
- `create_document` / `rename_document` / `move_document` / `split_scene` / `merge_scenes`

**Codex / mundo**
- `codex_search` / `codex_get` / `codex_upsert`
- `timeline_get` / `timeline_add_event`
- `continuity_check` — contradicciones vs Codex + capítulos citados
- `assemble_context` — empaqueta escena + fichas presentes + estilo + beats vecinos (el “Story Bible on the wire”)

**Plot**
- `outline_get` / `outline_update`
- `story_grid_get`

**Versiones**
- `history_list` / `history_get` / `history_blame`
- `rollback` — a commit, a snapshot, o a op-id de carácter
- `diff` — entre dos puntos, granularidad char/word/scene

**Git**
- `git_status` / `git_commit` / `git_log` / `git_branch` / `git_push` / `git_pull`

**Agentes internos**
- `spawn_agent` — writer / editor / continuity / plotter (opt-in)
- `run_prompt_recipe` — recetas del usuario

**Estilo**
- `get_style` / `get_voice_profile`

Reglas MCP:
- Toda escritura pasa por el mismo pipeline de historial que el teclado humano.
- Confirmación en UI para writes destructivos si Settings → “Ask before agent writes” está ON (default ON para delete de documentos).
- Scopes: read-only vs read-write. El usuario elige qué clientes tienen write.
- Log de tools visible en el panel MCP.

---

## 7. Versionado: Git + historial de carácter (los dos)

### 7.1 Git / GitHub (obra, ramas, colaboración)

- Init Git al crear proyecto.
- Conectar GitHub (device flow OAuth) o remote SSH/HTTPS genérico.
- Commit manual + “Commit checkpoint” con mensaje auto (capítulo, words ±, modelo usado).
- Auto-commit configurable: cada N minutos / cada capítulo cerrado / antes de cada write de agente.
- Branches: `main`, `draft/ch-12-alt`, experimentos de plot.
- Push/pull/PR opcionales. Issues no son el foco.
- `.gitignore` correcto (cache embeddings, secrets, modelos).
- Nunca commitear API keys.

Git NO basta para “rollback de una palabra de hace 40 minutos dentro de un commit”. Por eso:

### 7.2 Character-level operation log (CRDT o event sourcing)

Cada cambio del editor o de un agente es una operación:

```
{ id, ts, author: "human"|"claude-code"|"ollama:qwen3:14b",
  docId, type: insert|delete, offset, text, prevId }
```

Persistido en `.quillforge/crdt/` compactado por capítulos.

Capacidades:
- Undo/redo ilimitado por sesión.
- Timeline del documento: scrubber como video.
- Rollback de **un carácter, una palabra, una frase, un párrafo, una escena**.
- Blame: quién (humano vs qué modelo) escribió cada span.
- Restore atómico de un rango sin perder el resto.
- Snapshots nombrados (“antes de matar a X”).
- Compactación: ops antiguas se squash a snapshots + packfiles, blame se conserva.
- Búsqueda “mostrar todo lo que escribió Claude el martes”.
- Diff word-level e intra-word.

Si hay conflicto Git vs ops: 3-way merge a nivel de documento; si no se puede, crear rama `conflict-*` y UI de merge de escenas, no de líneas crudas solamente.

---

## 8. Features de novela (el producto, no solo el router)

Asumidas como parte del MVP+ :

- Binder + corkboard + outliner
- Codex con relaciones (A conoce a B, A odia a C) y family tree simple
- Timeline de historia vs orden de capítulos
- Metas y racha de escritura
- Focus modes
- Find/replace proyecto entero
- Continuity checker (nombres, color de ojos, fechas, objetos)
- Recetas de prompt guardadas (Continue, Describe, Workshop)
- Import/export de primer nivel (los 5):
  1. Markdown (canónico)
  2. DOCX — Standard Manuscript Format (Times/Courier 12, double-space, header apellido/título/página) para agentes
  3. EPUB 3 validado (Ace/epubcheck)
  4. PDF print-ready (márgenes, recto de capítulo, running heads)
  5. Scrivener `.scriv` — import Binder/capítulos/notas/synopsis; export carpeta compilable o pack .scriv lo más fiel posible
- Dark/light, tipografías de lectura
- Multi-proyecto dashboard
- Locale EN: curly quotes, em-dash dialogue optional
- Locale ES: comillas «» o “”, raya de diálogo (—), conteo de palabras ES, ordinales

### Modo Creativo (hueco v1, implementar v1.1+)
Botón visible pero disabled o detrás de “Coming soon”: genera/continúa capítulos enteros. v1 SOLO: rewrite/describe/shorten sobre **selección**, con diff antes de aplicar.

### Censura
Settings → Safety → Censorship: ON/OFF.
- OFF: router prefiere Ollama uncensored / GGUF abliterated / Grok / OpenRouter sin filtro; Claude/ChatGPT se marcan “may refuse”.
- ON: no ofrecer modelos uncensored por default.
Override por provider.

Fuera de v1: live multiplayer, marketplace, portada, audiolibro, Modo Creativo real.

---

## 9. Privacidad y seguridad

- Local-first. SQLite o files + ops.
- Keychain / libsecret / Windows Credential Manager para tokens.
- Allowlist de hosts. MCP solo localhost por default.
- Modo avión: solo modelos locales.
- Telemetría OFF por default.
- Pantalla de “qué se envió” por cada call cloud (truncatable).
- Cifrado de carpeta de proyecto opcional (password).

---

## 10. CLI

```
quill new "Mi novela"
quill open ./mi-novela
quill mcp serve
quill status
quill commit -m "..."
quill rollback --doc ch-12 --to op:abc123
quill export --epub
```

---

## 10b. i18n

- Bundles: `locales/en/`, `locales/es/`
- Cada string por clave. ICU MessageFormat.
- `project.json.locale` y `ui.locale` independientes (UI en ES, manuscrito EN o al revés).
- Quotes, dash, word-count, spellcheck hunspell en-US + es-ES/es-419.
- Añadir un idioma futuro = nuevo folder + diccionario + quote rules. No hardcodear.

## 10c. Licencia y dueño

- Copyright © del fundador (el usuario de este briefing).
- SPDX: Apache-2.0
- TRADEMARKS.md: nombre + logo reservados. Forks deben cambiar nombre.
- NOTICE y CLA para contributors.
- No CLA agresivo que ceda el copyright del fundador.

## 11. Onboarding

1. Wizard hardware: RAM/GPU → recomienda pack LOW/MID/HIGH.
2. Detect CLIs. Un clic “Conectar los que encontré”.
3. Crear o abrir carpeta. Init Git.
4. Plantilla: novela en blanco / tres actos / Save the Cat / Kishōtenketsu / saga.
5. Primera escena. Atajo: seleccionar texto → Continuar con modelo X.

No forzar signup.

---

## 12. No-goals (para no inflar)

- No es Wattpad.
- No es generador one-click de novela + portada + audio.
- No es IDE de código (aunque hable con CLIs de código).
- No lock-in de formato.

---

## 13. Criterios de éxito

- En una máquina con Claude Code + Ollama instalados, al abrir Settings ambos aparecen Connected sin pegar keys.
- OpenCode puede leer el capítulo activo y reemplazar un párrafo vía MCP; esa edición aparece en el timeline con author=opencode y se puede rollbackear esa palabra.
- Un capítulo de 4k palabras con 200 edits humanos + 30 de IA permite rewind a cualquier palabra en <100ms para el doc activo.
- GitHub push de la carpeta funciona y otro dispositivo clona; ops se reconstruyen o se empaquetan en snapshots commiteables.
- App usable 100% offline con un GGUF MID.

---

## 14. Entregable que debes producir ahora

1. Nombre + one-liner + arquitectura de módulos.
2. Wireframe textual de las 6 pantallas clave (Dashboard, Editor, Agents, MCP, History, Settings).
3. Schema de `quillforge.json` + frontmatter de capítulo + schema de una op.
4. Lista priorizada MVP / v1.1 / v2.
5. Riesgos técnicos (CRDT vs git, harnesses que cambian de flag, MCP write safety).
6. Plan de detección de binarios por OS.

Implementa con calidad de producto real, no de demo.
