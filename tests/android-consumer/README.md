# Native Android consumer proof

This synthetic Expo application compiles the SDK's actual Kotlin module and runs its Robolectric state/reporter tests. It never initializes analytics, contains no key or app data, and does not launch or crash an application.

From a standalone SDK source checkout, install/build the SDK root, then:

```sh
npm ci --ignore-scripts --prefix tests/android-consumer
node tests/android-consumer/test-native.mjs
```

Use Node 24, JDK 21 and an installed Android SDK (`ANDROID_HOME`). Expo 58.0.21, React Native 0.88.1 and React/ReactDOM 19.3.0 are frozen in the fixture lockfile. The SDK dependency is the local `../..` source tree; no Corlex registry release, private repository or prebuilt AAR is used. Native dependencies are downloaded from their normal public repositories. Gradle runs without a persistent daemon, with two workers and a 2 GiB heap.

The runner audits every npm dependency severity, regenerates **only this fixture's** ignored Android directory and checks the generated wrapper JAR against the official Gradle 9.3.1 hash. The selected 9.4.1 distribution URL is fixed and receives its official SHA-256 before Gradle executes. Unexpected wrapper bytes, URL or checksum fail closed. Every run also verifies this using a copied wrapper with a changed byte, malicious URL and incorrect checksum; the real generated wrapper stays intact. Official evidence: https://gradle.org/release-checksums/ (9.3.1 wrapper; 9.4.1 binary ZIP). The generated template deliberately uses these different versions. The frozen npm override updates the affected Expo fingerprint minimatch dependency to 11.0.8; Expo prebuild/native tests exercise it, and `npm audit --audit-level=low` must stay green.

The proof checks both state and crash reporter JUnit reports for executed cases, zero failures/errors and zero skips. Generated native projects, npm modules and Gradle outputs are excluded from source/release exports.

The native module constrains its Robolectric test-only Okio, Guava and Bouncy Castle
transitives to patched versions. These `testImplementation` constraints do not
change the SDK release runtime or the host application's dependency graph.
