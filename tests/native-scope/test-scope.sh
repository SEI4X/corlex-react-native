#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rn=$(CDPATH= cd -- "$here/../.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/corlex-native-scope.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
core="$rn/ios/CorlexCrashCore"
for source in "$core"/*.c "$rn/ios/CorlexSignalHandler.c"; do
  name=$(basename "$source" .c)
  clang -O2 -fsanitize=address,undefined -I "$core/include" -c "$source" -o "$work/$name.o"
done
printf '#include "%s"\n#include "%s"\n' "$core/include/CorlexRNCrash.h" "$rn/ios/CorlexSignalHandler.h" > "$work/Bridge.h"
cp "$here/main.swift" "$work/main.swift"
swiftc -sanitize=address -import-objc-header "$work/Bridge.h" "$rn/ios/CorlexProcessPrivacy.swift" "$rn/ios/CorlexPrivacyJson.swift" "$rn/ios/CorlexStateCodec.swift" "$rn/ios/CorlexStateStore.swift" "$rn/ios/CorlexMainThread.swift" "$rn/ios/CorlexNativeWriter.swift" "$rn/ios/CorlexCrashReporter.swift" "$work/main.swift" "$work"/*.o -o "$work/test-scope"
"$work/test-scope" "$work/state"

cp "$here/thread.swift" "$work/main.swift"
swiftc -sanitize=address -import-objc-header "$work/Bridge.h" "$rn/ios/CorlexMainThread.swift" "$work/main.swift" "$work"/*.o -o "$work/test-thread"
ASAN_OPTIONS=use_sigaltstack=0 "$work/test-thread"
