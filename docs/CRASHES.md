# Crash capture and matching symbols

Default automatic reports use generic messages and validated static symbols/bundle basenames. Private paths and arbitrary native text frames are discarded; captureErrorMessages:true explicitly permits bounded detailed messages. Explicit event properties still require review. Native handlers chain to previous handlers. iOS uses the owned namespaced shared C core with bounded image UUID/address frames and signal-safe capture; its admitted fatal report is terminal for the process. Only nonblocking alternate-stack preparation runs on main before state/reporter locks; protected IO remains on the JS worker. An enabled host stack is preserved, and alternate-stack overflow support is main-thread scoped, not a guarantee for every worker-thread overflow. Android captures static JVM frames for R8 retrace. Rebuild the native module; Expo Go cannot capture native crashes.

Every native install/recovery/write is admitted using its originating owner/generation tuple; another selected owner cannot receive an older queued operation. Files include matching scope metadata and recovery rejects mismatches. Ordinary analytics remains platform react-native; native crash dispatch uses its original ios/android platform. Connection verification and readable crash symbolication are separate proofs. Do not deliberately crash a user's application to verify ordinary connection.

For JS/Hermes use the final composed map matching the deployed bundle and exact original native version/build:

```sh
node scripts/upload-sourcemaps.mjs final.map index.android.bundle --react-native 1.2.3 45
```

The build-only uploader strips sourcesContent/private source paths, bounds input, rejects redirects and derives an exact version+build release key. Version must fit 128 UTF-8 bytes and build 32; invalid/oversized values are rejected. Install expo-application for nativeBuildVersion. Native dSYM/R8 upload tools are separate companion build tools: use the owning Corlex installation guide and matching Release dSYM/mapping assets; do not install additional analytics SDKs. Provision upload credentials into ignored .corlex/symbols.env or CI secrets, never the application bundle. scripts/with-symbols.sh sources only the host build environment; absent tokens leave builds running without upload. Delivery alone does not prove readable symbolication.
