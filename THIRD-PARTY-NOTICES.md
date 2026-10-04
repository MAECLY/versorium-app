# Third-party notices

Versorium is licensed under the GNU Affero General Public License v3.0 (see `LICENSE`; it was Apache-2.0 until 2026-10-04). It links third-party
code into its binary and its webview, and several of those licences require
their notices to travel with the program. This file ships inside the
application bundle (`bundle.resources` in `src-tauri/tauri.conf.json`), not
only in the repository.

**Status: incomplete.** This file names every native component and webview
package built into Versorium, every Rust crate that is MIT only or Apache-2.0
only, and every Rust crate whose licence is outside MIT and Apache-2.0. The
remaining crates, licensed under a choice that includes MIT or Apache-2.0, are
named only in `src-tauri/Cargo.lock`. It gives a copyright line
for the native C and C++ components, for the webview packages, and for the
Rust crates whose licence is outside MIT and Apache-2.0. It does not give a
copyright line for the other Rust crates, and it reproduces the full licence
text only for llama.cpp and the Windows WebView2 loader. Five items are open
(see [Open items](#open-items)). Until a generated licence bundle replaces this
hand-written list, treat it as an inventory, not as a finished compliance
document.

## How this list was made

Checked on 2026-10-03 against `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
and `package.json`:

- Rust: `cargo tree -e normal,no-proc-macro --prefix none --format '{p}|{l}'`
  for each of the four release targets (`aarch64-apple-darwin`,
  `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`),
  with and without `--features vulkan`, de-duplicated by name and version. That
  gives 378 third-party crates, plus `versorium` itself. Procedural macros and
  the crates reachable only through them run at build time and are not
  counted; neither are `[build-dependencies]` or `[dev-dependencies]`.
- C and C++: the build scripts of the `-sys` crates in that set, the
  `cargo:rustc-link-lib` lines they emit, `otool -L` and a symbol check (`nm`)
  of a macOS debug build of the binary, to tell code that is compiled *and
  linked* from code that is only compiled.
- Frontend: a production `vite build` with source maps, listing every package
  under `node_modules` whose code ends up in the emitted JavaScript or CSS,
  whether `package.json` lists it under `dependencies` or `devDependencies`.
  Build and test tooling (Vite, Vitest, Playwright, svelte-check, TypeScript,
  jsdom, the Tauri CLI) leaves no code in the bundle.

---

## Native code compiled into the binary

### llama.cpp / ggml

The local inference engine, compiled in-process through the `llama-cpp-2` and
`llama-cpp-sys-2` crates, both pinned at `=0.1.157`. The published crate
vendors the full C++ sources. Versorium enables the `common` feature and not
`mtmd`. GPU offload is Metal on macOS; the Windows and Linux release builds add
the Vulkan backend through the `vulkan` Cargo feature.

> MIT License
>
> Copyright (c) 2023-2026 The ggml authors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

Two parts of ggml that are linked in carry their own MIT copyright line. The
MIT text above applies to each with its own line substituted:

| Component | Licence | Copyright |
|---|---|---|
| llamafile sgemm (`ggml/src/ggml-cpu/llamafile/sgemm.cpp`) | MIT | Copyright 2024 Mozilla Foundation |
| YaRN RoPE scaling (`ggml-cpu/ops.cpp`, `ggml-metal/kernels/rope.metal`) | MIT | Copyright (c) 2023 Jeffrey Quesnelle and Bowen Peng |

The Vulkan backend is compiled against the Vulkan headers of the LunarG Vulkan
SDK installed on the CI runner. Their licence was not checked for this file.
The Vulkan loader itself (`libvulkan1` on Linux, `vulkan-1.dll` on Windows) is
a system library and is not bundled.

### libgit2

Compiled from source through `git2` 0.19 with `vendored-libgit2`
(`libgit2-sys` 0.17.0+1.8.1, libgit2 1.8.1).

| Component | Licence | Copyright |
|---|---|---|
| libgit2 | GPL-2.0 with the libgit2 linking exception | Copyright (C) the libgit2 contributors |
| llhttp (`deps/llhttp`) | MIT | Copyright Fedor Indutny, 2018 |
| xdiff (`deps/xdiff`) | LGPL-2.1-or-later | Copyright (C) 2003 Davide Libenzi |
| PCRE (`deps/pcre`) | BSD-3-Clause | Copyright (c) 1997-2021 University of Cambridge |
| SHA-1 collision detection | MIT | Copyright (c) 2017 Marc Stevens, Dan Shumow |
| wildmatch | BSD | Copyright Rich Salz |

The linking exception lets libgit2 be linked into a program under any licence.
libgit2's `COPYING` file is the authoritative notice and lists further bundled
portions (derived from LLVM, Unicode, Inc., sheredom/utf8.h and others); it is
not reproduced here yet.

HTTPS in libgit2 uses Secure Transport on macOS, WinHTTP on Windows and OpenSSL
on Linux. The `https` feature also pulls in `openssl-sys` on every `cfg(unix)`
target, macOS included (`libgit2-sys` declares it that way), so the binary
links OpenSSL on macOS as well as on Linux:

- Linux: the system's OpenSSL 3. The `.deb` declares `libssl3` as a
  dependency.
- macOS: OpenSSL **3.6.3 is built into the app** (`git2`'s `vendored-openssl`,
  through `openssl-src` 300.6.1+3.6.3), because macOS ships no OpenSSL. Before
  2026-10-04 the binary linked whatever the build machine had — Homebrew's
  `/opt/homebrew/opt/openssl@4` — and would not start on a Mac without it;
  `otool -L` on the Apple silicon and Intel release binaries now lists only
  system libraries.

  OpenSSL — Apache License 2.0. Copyright (c) 1998-2025 The OpenSSL Project
  Authors; Copyright (c) 1995-1998 Eric A. Young, Tim J. Hudson. All rights
  reserved. The full licence text is in `LICENSES/Apache-2.0.txt`; OpenSSL's
  own copy is at https://www.openssl.org/source/license.html.

### Zstandard

`zstd-sys` 2.1.0 (zstd 1.5.7), compiled from source because the `zip` crate's
default features include zstd.

BSD-3-Clause. Copyright (c) Meta Platforms, Inc. and affiliates.

### ring

`ring` 0.17.14, the cryptography under `rustls`, compiles C and assembly
derived from BoringSSL.

Apache-2.0 AND ISC. The licence is given at the top of each source file:

| Part | Licence | Copyright |
|---|---|---|
| ring's own code | ISC | Copyright 2015-2025 Brian Smith |
| C and assembly taken from OpenSSL through BoringSSL | Apache-2.0 | Copyright 1995-2020 The OpenSSL Project Authors (year ranges vary per file) |
| C taken from BoringSSL | Apache-2.0 | Copyright 2014-2024 The BoringSSL Authors (year ranges vary per file) |
| Other BoringSSL-derived files | ISC | Copyright (c) 2014, Google Inc.; Copyright (c) 2014, Intel Corporation |
| fiat-crypto field arithmetic (`third_party/fiat`) | Apache-2.0 | Copyright 2015-2020 the fiat-crypto authors |

`LICENSE-BoringSSL` and `LICENSE-other-bits` in the crate hold the full texts.

### Microsoft WebView2 loader (Windows only)

`webview2-com-sys` 0.39.1 links Microsoft's `WebView2LoaderStatic.lib`
statically when the target is MSVC (`link(name = "WebView2LoaderStatic",
kind = "static")` under `target_env = "msvc"`), and the Windows release is an
MSVC build. `wry` calls `CreateCoreWebView2EnvironmentWithOptions` from it, so
the loader is part of `Versorium.exe`. The text below is the `LICENSE.txt` of
the current `Microsoft.Web.WebView2` NuGet package; which SDK version the crate
took its `.lib` from was not identified.

> Copyright (C) Microsoft Corporation. All rights reserved.
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are
> met:
>
> * Redistributions of source code must retain the above copyright
>   notice, this list of conditions and the following disclaimer.
> * Redistributions in binary form must reproduce the above
>   copyright notice, this list of conditions and the following disclaimer
>   in the documentation and/or other materials provided with the
>   distribution.
> * The name of Microsoft Corporation, or the names of its contributors
>   may not be used to endorse or promote products derived from this
>   software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
> "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
> LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
> A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
> OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
> SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
> LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
> DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
> THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
> (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
> OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### zlib (Windows only)

`libz-sys` 1.1.29, pulled in by libgit2, compiles its bundled zlib on Windows
(MSVC). On macOS it links the system `libz`. On Linux it links the system zlib
when `pkg-config` finds one on the build machine, which was not checked for the
release runner.

Zlib licence. Copyright (C) 1995-2026 Jean-loup Gailly and Mark Adler.

---

## Rust crates

The 378 crates are recorded with exact versions in `src-tauri/Cargo.lock`.
Most are MIT, Apache-2.0, or a choice that includes one of them; none of the
shipped crates carries an Apache `NOTICE` file. The crates below have a licence
outside that set, or a licence that applies in addition to it:

| Crate | Version | Licence | Copyright |
|---|---|---|---|
| `option-ext` | 0.2.0 | MPL-2.0 | Simon Ochsenreither (crate author; the licence file has no copyright line) |
| `icu_collections`, `icu_locale_core`, `icu_normalizer`, `icu_normalizer_data`, `icu_properties`, `icu_properties_data` | 2.3.0 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| `icu_provider` | 2.3.1 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| `litemap` 0.8.3, `potential_utf` 0.1.6, `tinystr` 0.8.4, `writeable` 0.6.4, `yoke` 0.8.3, `zerofrom` 0.1.8, `zerotrie` 0.2.5, `zerovec` 0.11.8 | — | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| `unicode-ident` | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 | Unicode data: Copyright © 1991-2023 Unicode, Inc. |
| `ring` | 0.17.14 | Apache-2.0 AND ISC | See [ring](#ring) above |
| `rustls-webpki` | 0.103.15 | ISC | Copyright 2015 Brian Smith |
| `untrusted` | 0.9.0 | ISC | Copyright 2015-2016 Brian Smith |
| `webpki-roots` | 1.0.9 | CDLA-Permissive-2.0 (Mozilla's root certificate list) | none given in the licence file |
| `zstd-sys`, `zstd-safe` | 2.1.0, 7.3.0 | BSD-3-Clause | Copyright (c) 2026, Alexandre Bury (as the crates' licence files read); zstd itself: see [Zstandard](#zstandard) |
| `brotli` | 9.0.0 | BSD-3-Clause AND MIT | Copyright (c) 2009, 2010, 2013-2016 by the Brotli Authors; Copyright (c) 2016 Dropbox, Inc. |
| `alloc-no-stdlib`, `alloc-stdlib` | 3.0.0, 0.3.0 | BSD-3-Clause | Copyright (c) 2016 Dropbox, Inc. (`alloc-stdlib` ships no licence file) |
| `subtle` | 2.6.1 | BSD-3-Clause | Copyright (c) 2016-2017 Isis Agora Lovecruft, Henry de Valence; Copyright (c) 2016-2024 Isis Agora Lovecruft |
| `encoding_rs` | 0.8.42 | (Apache-2.0 OR MIT) AND BSD-3-Clause (WHATWG data) | Copyright Mozilla Foundation; Copyright © WHATWG (Apple, Google, Mozilla, Microsoft) |
| `dpi` | 0.1.2 | Apache-2.0 AND MIT | MIT part is code from `rust-lang/libm`; `LICENSE-LIBM-MIT` carries its musl, FreeBSD and Sun Microsystems copyright lines |
| `zlib-rs` | 0.6.7 | Zlib | (C) 2024 Trifecta Tech Foundation |
| `libbz2-rs-sys` | 0.2.5 | bzip2-1.0.6 (a Rust port of bzip2) | Copyright (C) 1996-2021 Julian R Seward; Copyright (C) 2019-2020 Federico Mena Quintero; Copyright (C) 2021 Micah Snyder; Copyright (C) 2024-2025 Trifecta Tech Foundation and contributors |
| `ppmd-rust` | 1.5.0 | CC0-1.0 OR MIT-0 | Copyright 2026 The ppmd-rust authors (MIT-0 asks for no notice) |

`ppmd-rust` ships because `zip`'s default features include `ppmd`.

The source of the MPL-2.0 crate above is available, unmodified, from
crates.io at the version listed.

Crates whose licence is a choice that includes MIT or Apache-2.0 (for example
`Unlicense OR MIT`, `Zlib OR Apache-2.0 OR MIT`, `Apache-2.0 OR BSL-1.0`,
`BSD-3-Clause/MIT`, as `brotli-decompressor` 6.0.1 is) are used under MIT or
Apache-2.0 and are not repeated here. Both of those licences still ask for a
notice in a binary distribution: MIT for the copyright and permission notice,
Apache-2.0 for a copy of the licence. This file does not yet carry those
notices for any of these crates (see [Open items](#open-items)).

Four shipped crates are Apache-2.0 only: `lzma-rust2` 0.13.0, `sync_wrapper`
1.0.2, `tao` 0.37.1 and `zopfli` 0.8.3.

These 84 shipped crates are MIT only, with no Apache-2.0 alternative, so their
copyright and permission notice has to travel with the binary. This file names
them but does not yet reproduce those notices:
`atk` 0.18.2, `atk-sys` 0.18.2, `block2` 0.6.2, `bytes` 1.12.1, `cairo-rs`
0.18.5, `cairo-sys-rs` 0.18.2, `cfb` 0.7.3 and 0.14.0, `deflate64` 0.1.12,
`dlopen2` 0.8.2, `endi` 1.1.1, `gdk` 0.18.2, `gdk-pixbuf` 0.18.5,
`gdk-pixbuf-sys` 0.18.0, `gdk-sys` 0.18.2, `gdkwayland-sys` 0.18.2, `gdkx11`
0.18.2, `gdkx11-sys` 0.18.2, `generic-array` 0.14.7, `gio` 0.18.4, `gio-sys`
0.18.1, `glib` 0.18.5, `glib-sys` 0.18.1, `gobject-sys` 0.18.0, `gtk` 0.18.2,
`gtk-sys` 0.18.2, `http-body` 1.1.0, `http-body-util` 0.1.5, `hyper` 1.11.1,
`hyper-util` 0.1.20, `infer` 0.19.0 and 0.22.0, `is-docker` 0.2.0, `is-wsl`
0.4.0, `javascriptcore-rs` 1.1.2, `javascriptcore-rs-sys` 1.1.1, `memoffset`
0.9.1, `minisign-verify` 0.2.5, `mio` 1.2.3, `objc2` 0.6.4, `objc2-encode`
4.1.0, `objc2-foundation` 0.3.2, `open` 5.4.4, `openssl-sys` 0.9.116, `pango`
0.18.3, `pango-sys` 0.18.0, `phf` 0.13.1, `phf_shared` 0.13.1, `plist` 1.10.1,
`quick-xml` 0.42.0, `rfd` 0.16.0, `simd-adler32` 0.3.10, `slab` 0.4.12,
`soup3` 0.5.0, `soup3-sys` 0.5.0, `sysinfo` 0.39.6, `tokio` 1.53.1,
`tokio-util` 0.7.19, `tower` 0.5.3, `tower-http` 0.6.11, `tower-layer` 0.3.3,
`tower-service` 0.3.3, `tracing` 0.1.44, `tracing-core` 0.1.36, `trash`
5.2.9, `try-lock` 0.2.5, `urlencoding` 2.1.3, `urlpattern` 0.6.0, `want`
0.3.1, `webkit2gtk` 2.0.2, `webkit2gtk-sys` 2.0.2, `webview2-com` 0.39.1,
`webview2-com-sys` 0.39.1, `winnow` 1.0.4, `x11` 2.21.0, `x11-dl` 2.21.0,
`zbus` 5.19.0, `zbus_names` 4.3.4, `zcheapstr` 1.1.0, `zip` 5.1.1, `zmij`
1.0.23, `zstd` 0.13.3, `zvariant` 5.15.0, `zvariant_utils` 4.2.0.

Some crates appear in `Cargo.lock` but are reached only through a procedural
macro at build time and do not ship: among them `cssparser`, `selectors` and
`dtoa-short` (MPL-2.0) and `foldhash` 0.2.0 (Zlib), all pulled in by
`tauri-codegen` through `tauri-macros`.

---

## Frontend (webview)

The bundled JavaScript and CSS include:

| Component | Version | Licence | Copyright |
|---|---|---|---|
| Svelte 5 runtime (`svelte`, a `devDependency` whose runtime the compiler bundles) | 5.57.0 | MIT | Copyright (c) 2016-2025 Svelte Contributors |
| `esm-env` (pulled in by Svelte) | 1.2.2 | MIT | Copyright 2022 Benjamin McCann |
| `@codemirror/autocomplete`, `commands`, `lang-css`, `lang-html`, `lang-javascript`, `lang-markdown`, `language`, `search`, `state`, `view` | per `pnpm-lock.yaml` | MIT | Copyright (C) 2018-2021 by Marijn Haverbeke and others |
| `@lezer/common`, `css`, `highlight`, `html`, `javascript`, `lr`, `style-mod` | per `pnpm-lock.yaml` | MIT | Copyright (C) 2018 by Marijn Haverbeke and others |
| `@lezer/markdown` | per `pnpm-lock.yaml` | MIT | Copyright (C) 2020 by Marijn Haverbeke and others |
| `w3c-keyname` | per `pnpm-lock.yaml` | MIT | Copyright (C) 2016 by Marijn Haverbeke and others |
| `crelt` | per `pnpm-lock.yaml` | MIT | Copyright (C) 2020 by Marijn Haverbeke |
| `@marijn/find-cluster-break` | per `pnpm-lock.yaml` | MIT | Copyright (C) 2024 by Marijn Haverbeke |
| `@tauri-apps/api` | per `pnpm-lock.yaml` | Apache-2.0 OR MIT (used under MIT) | Copyright (c) 2017 - Present Tauri Apps Contributors |
| `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-opener` | 2.7.3, 2.6.0 | MIT OR Apache-2.0 (used under MIT) | 2019-2022, The Tauri Programme in the Commons Conservancy |
| Tailwind CSS (`tailwindcss`, a `devDependency`): the generated stylesheet, including its base reset ("preflight") | 4.3.3 | MIT | Copyright (c) Tailwind Labs, Inc. |

The `lang-css`, `lang-html` and `lang-javascript` packages and their Lezer
parsers are not imported by `src/` directly; `@codemirror/lang-markdown` pulls
them in for fenced code blocks.

Two packages in `dependencies` are not in the bundle. Nothing in `src/` imports
the `codemirror` meta-package, and nothing imports
`@tauri-apps/plugin-updater`: the updater runs through the Rust crate
`tauri-plugin-updater`.

No fonts are bundled. `fonts/catalog.json` resolves every font to families
already installed on the machine.

---

## Compiled but not linked, or not built

These are present in the sources Versorium builds from but do not end up in
the shipped binary:

- **llama.cpp `vendor/`.** `vendor/hash` (xxHash, SHA-1, SHA-256) is compiled
  into `libvendor-hash.a` and `cpp-httplib` into `libcpp-httplib.a`, but
  neither is on the link list that `llama-cpp-sys-2`'s build script emits.
  `nlohmann/json` and `sheredom/subprocess.h` are compiled into
  `libllama-common`, which is linked, but none of their symbols is in the
  linked binary (checked with `nm` on a macOS debug build). `stb_image` and
  `miniaudio` are used only by `mtmd`, which Versorium does not enable, and are
  not built. If a future change calls more of llama.cpp's `common` library,
  recheck these.
- **llama.cpp's SYCL and OpenVINO backends**, which carry Apache-2.0 files.
  Neither is built. llama.cpp ships no `NOTICE` file.

## System libraries the binary links but does not ship

With `bundle.targets` set to `"all"` in `src-tauri/tauri.conf.json`, a release
produces `Versorium.app` in a `.dmg` on macOS; a `.deb`, an `.rpm` and an
`.AppImage` on Linux; and an MSI and an NSIS installer on Windows. Except for
the AppImage (see [Open items](#open-items)), none of them carries these
libraries:

- **macOS:** WebKit and the other system frameworks, `libc++`, `libz`,
  `libiconv`. (OpenSSL is built in; see [libgit2](#libgit2).)
- **Linux:** GTK, WebKitGTK, libsoup, OpenSSL 3, the Vulkan loader. The `.deb`
  declares `libvulkan1` and `libssl3` in `tauri.conf.json`; no dependency list
  is configured there for the `.rpm`.
- **Windows:** the WebView2 runtime and the Vulkan loader (`vulkan-1.dll`). The
  WebView2 *loader* is linked in; see
  [Microsoft WebView2 loader](#microsoft-webview2-loader-windows-only).

---

## Open items

1. **xdiff is LGPL-2.1-or-later and is statically linked.** LGPL section 6
   requires that a user can relink the program against a modified copy of the
   library. Publishing Versorium's Apache-2.0 source, which builds with
   `cargo`, may meet this once the repository is public (it is private today),
   but that has not been checked against the licence text.
2. **The Linux AppImage.** Tauri's AppImage bundler copies shared libraries
   from the build machine into the image (GTK, WebKitGTK and their
   dependencies, mostly LGPL). Which libraries end up in Versorium's AppImage
   has not been inspected, and their licences are not listed here.
3. **OpenSSL on macOS — resolved 2026-10-04.** Built into the app and credited
   under [libgit2](#libgit2).
4. **Notices for the Rust crates and the native components.** MIT, Apache-2.0,
   BSD, ISC, Zlib, Unicode-3.0 and bzip2-1.0.6 all ask for a copyright line,
   a licence text, or both to travel with a binary. This file gives copyright
   lines only for the components above and the crates in the Rust table, gives
   none for the other Rust crates (the 84 MIT-only crates listed above among
   them), and reproduces full licence text only for llama.cpp and the WebView2
   loader. libgit2's `COPYING` is not reproduced either.
5. **Vulkan headers.** The licence of the Vulkan SDK headers the Windows and
   Linux builds compile against was not checked.

---

## Models

Model weights are **not** distributed with Versorium. Each is downloaded from
Hugging Face only when the writer clicks Download in Settings → Local AI, and
is used under its own licence. The model card shows that licence under
Details. As recorded in `models/catalog.json`:

- Apache-2.0: the Qwen, SmolLM2, Gemma 4 and Nomic embedding entries.
- Llama 3.2 Community License: the Llama 3.2 1B Instruct entry.

A licence is the writer's to accept, so Versorium shows it rather than
accepting it on their behalf.

---

## Website (`docs/`)

The landing page at versorium.maecly.com is not part of the app. It ships one
font of its own:

- **Aguja Display** (`docs/assets/fonts/aguja-display-400.woff2`): a modified
  version of Source Serif 4 by Adobe — one weight (400) at optical size 60,
  subset to Latin and renamed, as the SIL Open Font License 1.1 requires of a
  modified version. Built reproducibly by `tests/landing/fonts.py`. The
  copyright line, the modification notice and the full licence text are in
  `docs/assets/fonts/OFL.txt`, which is served beside the font.

The page loads nothing from any other server.
