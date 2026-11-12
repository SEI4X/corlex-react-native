#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rn=$(CDPATH= cd -- "$here/../.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/corlex-native-writer.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
core="$rn/ios/CorlexCrashCore"
for source in "$core"/*.c "$rn/ios/CorlexSignalHandler.c"; do
  name=$(basename "$source" .c)
  clang -O2 -I "$core/include" -c "$source" -o "$work/$name.o"
done
printf '#include "%s"\n#include "%s"\n' "$core/include/CorlexRNCrash.h" "$rn/ios/CorlexSignalHandler.h" > "$work/Bridge.h"
cp "$here/writer.test.swift" "$work/main.swift"
swiftc -import-objc-header "$work/Bridge.h" "$rn/ios/CorlexProcessPrivacy.swift" "$rn/ios/CorlexPrivacyJson.swift" "$rn/ios/CorlexStateCodec.swift" "$rn/ios/CorlexNativeWriter.swift" "$work/main.swift" "$work"/*.o -o "$work/test-writer"
"$work/test-writer" "$work/default" default
"$work/test-writer" "$work/detailed" detailed
