# Third-party notices

Versorium is Apache-2.0. It links third-party code into its binary, and the
licences below require their notices to travel with it. This file ships inside
the application bundle, not only in the repository.

Rust crates are not listed individually: `cargo` records them in
`src-tauri/Cargo.lock`, and every one is MIT, Apache-2.0 or BSD. What follows is
the C and C++ code compiled into the binary, which has no lockfile of its own
and would otherwise go unrecorded.

---

## llama.cpp / ggml

The local inference engine, compiled in-process via the `llama-cpp-2` and
`llama-cpp-sys-2` crates. The published crate vendors the full C++ sources.

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

## Code vendored inside llama.cpp

These sit in llama.cpp's `vendor/` directory and are compiled with it.

| Component | Licence | Copyright |
|---|---|---|
| cpp-httplib | MIT | Copyright (c) 2026 Yuji Hirose |
| nlohmann/json | MIT | Copyright (c) 2013–2025 Niels Lohmann |
| stb_image | public domain / MIT | Sean Barrett |
| miniaudio | public domain / MIT-0 | David Reid |
| sheredom/subprocess.h | public domain (Unlicense) | Neil Henning |
| xxHash, SHA-1, SHA-256 (`vendor/hash`) | public domain / BSD-2-Clause | respective authors |

The MIT text above applies verbatim to cpp-httplib and nlohmann/json with their
own copyright lines substituted. The public-domain components impose no
conditions; they are listed because being accurate about what ships matters more
than listing only what is compulsory.

## What is not compiled in

llama.cpp's tree also carries Apache-2.0 files for Intel's SYCL and OpenVINO
backends. Versorium builds neither, so no Apache-2.0 NOTICE obligation arises
from them. Upstream ships no `NOTICE` file.

## Models

Model weights are **not** distributed with Versorium. Each is downloaded from
Hugging Face on request, under its own licence, which the model card names
before the download starts — Apache-2.0 for the Qwen and Nomic entries, the
Gemma Terms of Use for the Gemma entries. A licence is the writer's to accept,
so Versorium shows it rather than accepting it on their behalf.
