#!/bin/sh
set -eu

required_version="wasm-pack 0.15.0"
install_command="cargo install wasm-pack --version 0.15.0 --locked"

if ! command -v wasm-pack >/dev/null 2>&1; then
  printf '%s\n' "wasm-pack 0.15.0 is required. Install it with: $install_command" >&2
  exit 1
fi

if ! installed_version=$(wasm-pack --version 2>/dev/null); then
  printf '%s\n' "Unable to read the wasm-pack version. Reinstall it with: $install_command" >&2
  exit 1
fi

if [ "$installed_version" != "$required_version" ]; then
  printf '%s\n' "Expected $required_version, found $installed_version. Install it with: $install_command" >&2
  exit 1
fi

exec wasm-pack build crates/reference --target web --out-dir ../../src/reference/pkg
