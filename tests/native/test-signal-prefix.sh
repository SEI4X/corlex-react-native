#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/corlex-signal-asan.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
clang -std=c11 -D_DARWIN_C_SOURCE -D_GNU_SOURCE -fsanitize=address,undefined -fno-omit-frame-pointer -g \
  "$here/signal-prefix.test.c" -o "$work/signal-prefix"
case "$(uname -s)" in Darwin) leaks=0 ;; *) leaks=1 ;; esac
ASAN_OPTIONS=detect_leaks=$leaks UBSAN_OPTIONS=halt_on_error=1 "$work/signal-prefix"
