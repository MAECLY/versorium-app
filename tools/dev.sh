#!/bin/sh
# `make dev` and `make devtools`. Runs `tauri dev`, reusing a Vite that is
# already serving this checkout on :1420 instead of failing on the port.
#
# That Vite is usually Playwright's (it reuses one too) or a landing capture
# run; killing it would break whatever is using it, and it serves the same
# src/ with the same hot reload. A server from another checkout or another
# program is not reused: the app would load code that is not this tree's.
#
# Usage: tools/dev.sh PNPM [extra tauri args...]
set -eu

pnpm="$1"
shift
port=1420
root=$(cd "$(dirname "$0")/.." && pwd -P)

pid=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)

if [ -z "$pid" ]; then
	exec "$pnpm" tauri dev "$@"
fi

cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
command=$(ps -o command= -p "$pid" 2>/dev/null || true)

case "$command" in
*vite*)
	if [ "$cwd" = "$root" ]; then
		printf 'Reusing the Vite already serving this checkout on :%s (pid %s).\n' "$port" "$pid"
		# A null merge-patches the key away, so Tauri starts no Vite of its own
		# and waits on devUrl, which this one already answers.
		exec "$pnpm" tauri dev --config '{"build":{"beforeDevCommand":null}}' "$@"
	fi
	;;
esac

printf '\033[31merror:\033[0m port %s is taken by pid %s (%s), started in %s.\n' \
	"$port" "$pid" "${command:-unknown}" "${cwd:-unknown}" >&2
printf 'It is not a Vite for this checkout, so it is not reused. Stop it with: kill %s\n' "$pid" >&2
exit 1
