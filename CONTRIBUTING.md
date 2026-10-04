# Contributing to Versorium

Contributions are welcome: bug reports, fixes, translations, ideas.

## Before you open a pull request

- **Read and agree to the [Contributor License Agreement](CLA.md).** You keep
  the copyright in what you write; the agreement lets the project's owner keep
  publishing Versorium, change its licence or offer it commercially later.
  The pull request template asks you to confirm it.
- **Run the checks.** `make verify` runs the type checks, the locale check,
  the unit tests, the Rust tests and clippy, and the end-to-end tests. See
  [AGENTS.md](AGENTS.md) for how the code is laid out and the rules it keeps
  (no telemetry, no hardcoded interface text, English and Spanish).
- **Keep it small and say why.** One change per pull request, in conventional
  commit form (`fix(editor): …`, `feat(backup): …`).

## Licence and name

Versorium is published under the [GNU Affero General Public License v3.0](LICENSE).
The name, the wordmark and the mark are not covered by that licence: a fork
must use its own (see [TRADEMARKS.md](TRADEMARKS.md)). For a commercial
licence or any other arrangement, write to hola@maecly.com.
