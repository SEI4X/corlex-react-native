# API

| API | Behavior |
| --- | --- |
| init(options) | Once at application entry. key required; endpoint/configEndpoint select the owning cell. |
| track(name, properties?) | Explicit application event; caller chooses safe fields. |
| screen(name) | Explicit static screen name; Expo Router/React Navigation adapters are separate exports. |
| identify(id, traits?), setUserProperties(properties) | Links a caller-provided user identifier/properties; review personal data before sending. |
| reset() | Rotates identity; retains already queued events with their original captured IDs and does not withdraw consent. |
| flush() | Attempts delivery; successful completion alone is not proof of server ingestion. |
| getConsent(), optIn(), optOut() | Effective permission and explicit SDK choice; see privacy rules. |
| config.ready(), get(key,fallback), getAll(), onUpdate(listener) | Bounded validated config, launch snapshot by default; config.live is an explicit live-update option. |
| flag(key,fallback), experiment(key), useConfig(key,fallback) | Client evaluation; experiment reads record exposure once per person/test/session. |

Autocapture can disable appOpen, lifecycle, crashes or nativeCrashes individually, or all through false. Automatic event names include app_open, app_background, app_foreground, screen_view and corlex.crash. Detailed automatic messages require captureErrorMessages:true and may contain personal data. queue batching options are batchSize (1..500, default 20) and flushIntervalMs (default 5000). Generated TypeScript declarations are the exact API contract.
