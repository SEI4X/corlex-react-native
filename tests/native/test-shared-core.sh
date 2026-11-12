#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rn=$(CDPATH= cd -- "$here/../.." && pwd)
work=${CORLEX_NATIVE_TEST_OUTPUT:-$(mktemp -d "${TMPDIR:-/tmp}/corlex-shared-core.XXXXXX")}
if [ -z "${CORLEX_NATIVE_TEST_OUTPUT:-}" ]; then trap 'rm -rf "$work"' EXIT HUP INT TERM; fi
mkdir -p "$work"
node "$rn/scripts/verify-crash-core.mjs"
core="$rn/ios/CorlexCrashCore"
original=${CORLEX_IOS_CORE_DIR:-}
coexist=""
if [ -n "$original" ]; then
  test -d "$original" || { echo "Explicit iOS core folder is missing" >&2; exit 1; }
  coexist="-DCORLEX_TEST_COEXISTENCE"
fi
for source in "$core"/*.c "$here/shared-core.test.c"; do
  name=$(basename "$source" .c)
  clang -g -O2 -fno-omit-frame-pointer -fsanitize=address,undefined \
    -I "$core/include" $coexist -c "$source" -o "$work/$name.o"
done
if [ -n "$coexist" ]; then
  for source in "$original"/*.c; do
    name=$(basename "$source" .c)
    clang -g -O2 -fno-omit-frame-pointer -fsanitize=address,undefined \
      -I "$original/include" -c "$source" -o "$work/$name.o"
  done
fi
clang -fsanitize=address,undefined "$work"/*.o -o "$work/NativeReleaseFixture"
ASAN_OPTIONS=detect_leaks=0 UBSAN_OPTIONS=halt_on_error=1 "$work/NativeReleaseFixture" "$work/report.corlex"
xcrun dsymutil "$work/NativeReleaseFixture" -o "$work/NativeReleaseFixture.dSYM"
xcrun dwarfdump --uuid "$work/NativeReleaseFixture.dSYM" > "$work/uuid.txt"
python3 - "$work" <<'PYTHON'
import json, pathlib, sys, subprocess
work = pathlib.Path(sys.argv[1])
header, frame, *_ = (work / 'report.corlex').read_text().splitlines()
assert json.loads(header)['platform'] == 'ios'
kind, debug_id, base, address, image = frame.split('\t')[:5]
assert kind == 'F' and image == 'NativeReleaseFixture'
assert debug_id.upper() in (work / 'uuid.txt').read_text().upper()
assert int(address, 16) >= int(base, 16)
dwarf = work / 'NativeReleaseFixture.dSYM/Contents/Resources/DWARF/NativeReleaseFixture'
symbol = subprocess.check_output(['xcrun', 'atos', '-o', str(dwarf), '-l', base, address], text=True)
assert 'corlex_release_fixture' in symbol and 'shared-core.test.c:' in symbol, symbol
print(symbol.strip())
print('Matching Release dSYM UUID and structured frame passed')
PYTHON
