# Build and verification

Node 24.15.0/pnpm 10.33.4: pnpm install --frozen-lockfile; pnpm lint; pnpm typecheck; pnpm test; pnpm build; pnpm audit --audit-level low; pnpm pack:check. No consumer install hooks are used. Noble SHA-256 is bundled with its complete MIT notice; minimal own core/pure RC and synthetic vectors are vendored under internal/.

macOS native proofs: sh tests/native/test-signal-prefix.sh; sh tests/native/test-shared-core.sh; sh tests/native/test-writer.sh; sh tests/native-scope/test-scope.sh. These use isolated compiler probes, ASan/UBSan, namespace coexistence and an actual matching optimized Release dSYM. They never launch or deliberately crash a user application. Unit tests also compile the real Foundation state store and validate private storage/CAS/markers/budgets.

Hosted Android: JDK 21/AndroidSDK plus npm ci --ignore-scripts --prefix tests/android-consumer; node tests/android-consumer/test-native.mjs. See that fixture README for frozen matrix, exact official wrapper/distribution checks, altered-copy negative proof, all-severity npm audit and actual module/Robolectric gates. Generated projects/caches/AARs do not enter exports. Dependency/SBOM review distinguishes shipped runtime, optional peers and build/test tools; passing tests/scans is not a guarantee that no defect exists.
