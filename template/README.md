# Widget Template Contract

Use `template/index.js` and `template/manifest.json` as the starting point for new widgets.

## End-to-end flow

```mermaid
flowchart TD
  A[Web UI] -->|Download customized loader| B[main/web-main/web-main.js]
  B -->|Loads versioned bootstrap| C[main/module-loader/index.js]
  C -->|Loads launcher| D[main/launcher/index.js]

  D -->|app mode !runsInWidget| E[main/welcome/index.js]
  D -->|widget mode| F[Decode args.widgetParameter base64 JSON]
  F --> G[payload object]
  G -->|moduleUrl/manifestUrl/cacheKey| C
  C --> H[target widget module]

  D --> I[Build createWidget params]
  G -->|payload.params| I
  J[Scriptable runtime config] --> I
  I --> H
```

## Required export

- `createWidget(params)`

## Optional exports

- `launch(params)` for direct Scriptable execution
- `widgetParameter: string`
- `supportedFamilies: string[]`

## Direct Scriptable run (no launcher)

`template/index.js` includes a standalone trigger that calls `launch()` and opens a Scriptable `Alert` prompt for:

- API key (optional)
- `message` (optional demo parameter)
- required widget parameter (if `widgetParameter` export is non-empty)

To run directly in Scriptable, call `launch()` manually:

```js
const widgetModule = importModule("template/index")
await widgetModule.launch({ config, args, debug: true })
```

## Launcher-passed params

The launcher calls `createWidget(params)` with:

- `debug`
- `apiKey`
- `apiProvider`
- `loaderVersion`
- `params` (equals `payload.params` object, or `{}`)
- all fields from `payload.params` (flattened into top-level)
- Scriptable runtime config fields (for example `widgetFamily`, `runsInWidget`)
- `params` is always normalized to a plain key-value object (`{}` when missing/invalid)

Merge order in launcher (same for every child widget; payload must not be clobbered by host `config.params`):

1. Base fields: `debug`, `apiKey`, `apiProvider`, `loaderVersion`
2. Scriptable runtime `config` (flattened): e.g. `widgetFamily`, `runsInWidget`, …
3. `params` object (= normalized `payload.params`, or `{}`)
4. Flattened `payload.params` (each key also passed at the top level for destructuring)

When the child module exports a non-empty `widgetParameter` string, the launcher also sets top-level `widgetParameter` to the resolved value (same meaning as in `scriptable-widgets/.../template`).

Earlier keys are overridden by later ones only where the same property name appears again (flattened payload wins over stale keys from runtime).

## Named parameter style in child widget

You can avoid a confusing generic `params` bag by destructuring:

```js
async function createWidget({
  message = "",
  params = {},
  debug = false,
  widgetFamily,
  ...rest
} = {}) {
  // `message` is optional demo-only field
  // `params` is a key-value object from payload.params
}
```

## Payload shape (base64 JSON in `args.widgetParameter`)

```json
{
  "moduleUrl": "https://widgets.taoradar.space/bittensor/metagraph/index.js",
  "manifestUrl": "https://widgets.taoradar.space/bittensor/metagraph/manifest.json",
  "cacheKey": "metagraph_main",
  "params": {
    "message": "Hello from payload"
  }
}
```
