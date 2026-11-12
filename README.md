# Corlex for React Native and Expo

Analytics, screens, Remote Config/experiments and JavaScript/native crash capture. This is a reviewed-source **candidate**, version 0.1.0; no npm release or stable Git tag is assumed.

Tested matrix: Expo 58.0.21, React Native 0.88.1, React/ReactDOM 19.3.0. Supported peer ranges are limited to Expo 58, RN 0.88 and React 19. Bare RN requires compatible Expo modules and secure `expo/fetch`; the SDK does not use RN global fetch as an unsafe fallback. Rebuild the native application after installing/upgrading the module. Other major versions are unverified.

## Build and install this source

Use Node 24.15.0 and pnpm 10.33.4. Run `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm pack:check`. Install the resulting `.artifacts/corlex-sdk-react-native-0.1.0.tgz` in the host app. Run `npx expo install expo-application expo-device` for original app/build and device metadata, configure `plugins: ['@corlex/sdk-react-native']` in app.json, and rebuild iOS/Android. The package contains its minimal owned core; no private workspace dependency is required.

## Start after app consent

```ts
import { init, optIn, screen, track, flush, config } from '@corlex/sdk-react-native'
await init({
  key: process.env.EXPO_PUBLIC_CORLEX_KEY ?? '',
  endpoint: 'https://your-ingest.example',
  configEndpoint: 'https://your-config.example',
  consent: 'pending',
  allowInsecureHttp: __DEV__,
})
// Call only after your app has obtained the appropriate permission.
optIn()
screen('Budget')
track('budget_created', { kind: 'manual' })
await flush()
const limit = config.get('budget_limit', 100)
```

Replace endpoint placeholders with the owning Corlex cell's actual public URLs. The project SDK write key ships in the client bundle; `EXPO_PUBLIC_` is not a secret store. Never bundle MCP, symbol-upload or model-provider credentials. For bare RN use an ignored imported build config; process.env is not substituted automatically.

HTTPS is the default. Loopback/Android-emulator HTTP is permitted; other HTTP needs the explicit host-app development flag. Leave it false in production. URL credentials/query/fragment and redirects are rejected; proxy base paths are retained. No certificate bypass is installed.

See [API](docs/API.md), [data and privacy](docs/PRIVACY.md), [crashes](docs/CRASHES.md), [build/tests](docs/BUILDING.md), [release process](docs/PUBLISHING.md), [security](SECURITY.md), [changelog](CHANGELOG.md) and [MIT license](LICENSE).
