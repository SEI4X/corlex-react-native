#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rn=$(CDPATH= cd -- "$here/../.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/corlex-state-proof.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
for fixture in native-state native-process; do
  swiftc "$rn/ios/CorlexPrivacyJson.swift" "$rn/ios/CorlexProcessPrivacy.swift" "$rn/ios/CorlexStateCodec.swift" "$rn/ios/CorlexStateStore.swift" "$rn/tests/$fixture/main.swift" -o "$work/probe"
  "$work/probe"
done
