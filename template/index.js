// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: code;
//@ts-check

/**
 * Template for widgets loaded by `main/launcher/index.js`.
 * Full contract and workflow are documented in `template/README.md`.
 *
 * Required export:
 * - createWidget(params)
 *
 * Optional exports:
 * - launch(params) // standalone/direct execution helper
 * - widgetParameter: string
 * - supportedFamilies: string[] // "small" | "medium" | "large"
 */

/**
 * If non-empty, launcher expects this key in payload.params.
 * Example: "address", "hotkey", "widgetParameter"
 */
const widgetParameter = ""

/**
 * Optional render-size contract checked by launcher.
 * If omitted, launcher will not restrict by size.
 */
const supportedFamilies = ["small", "medium", "large"]

/**
 * Prefer named parameters via object destructuring.
 * `message` here is optional and only demonstrates parameter passing.
 *
 * @param {Record<string, unknown>} input
 */
async function createWidget({
    message = "",
    params = {},
    debug = false,
    widgetFamily,
    loaderVersion,
    apiProvider,
    ...rest
  } = {}) {
  const widget = new ListWidget()
  widget.backgroundColor = Color.black()

  const title = widget.addText("Template Widget")
  title.textColor = Color.white()
  title.font = Font.boldSystemFont(14)
  title.centerAlignText()

  widget.addSpacer(6)

  const nestedParams =
    params && typeof params === "object" && !Array.isArray(params)
      ? /** @type {Record<string, unknown>} */ (params)
      : {}
  const nestedMessage = typeof nestedParams.message === "string" ? nestedParams.message : ""
  const value = typeof message === "string" && message.trim()
    ? message.trim()
    : nestedMessage.trim()
      ? nestedMessage.trim()
      : "no message"
  const line = widget.addText(`message: ${value}`)
  line.textColor = Color.lightGray()
  line.font = Font.systemFont(11)
  line.centerAlignText()

  if (debug) {
    console.log(
      JSON.stringify(
        {
          widgetFamily,
          loaderVersion,
          apiProvider,
          paramsKeys: Object.keys(nestedParams),
          extraKeys: Object.keys(rest).filter(
            (k) =>
              ![
                "params",
                "message",
                "debug",
                "apiKey",
                "apiProvider",
                "loaderVersion",
                "widgetFamily"
              ].includes(k),
          ),
        },
        null,
        2,
      ),
    )
  }

  return widget
}

/**
 * Standalone + launcher-friendly trigger.
 * - Launcher can keep calling createWidget directly.
 * - Direct Scriptable execution can call launch() to prompt user input.
 */
async function launch(params = {}) {
  const runtimeConfig =
    params.config && typeof params.config === "object"
      ? params.config
      : typeof config !== "undefined" && config
        ? config
        : {}

  const initialParams =
    params.params && typeof params.params === "object" && !Array.isArray(params.params)
      ? /** @type {Record<string, unknown>} */ (params.params)
      : {}

  let normalizedParams = { ...initialParams }
  let apiKey = typeof params.apiKey === "string" ? params.apiKey : ""

  if (!runtimeConfig.runsInWidget) {
    const userInput = await promptForStandaloneInput({
      defaultApiKey: apiKey,
      requiredParamName: widgetParameter,
      defaultRequiredParam:
        widgetParameter && typeof normalizedParams[widgetParameter] === "string"
          ? /** @type {string} */ (normalizedParams[widgetParameter])
          : "",
      defaultMessage: typeof normalizedParams.message === "string" ? /** @type {string} */ (normalizedParams.message) : "",
    })

    if (!userInput) {
      return null
    }

    apiKey = userInput.apiKey
    if (userInput.message) {
      normalizedParams.message = userInput.message
    }
    if (widgetParameter) {
      normalizedParams[widgetParameter] = userInput.requiredParam
    }
  }

  const widget = await createWidget({
    debug: !!params.debug,
    apiKey,
    apiProvider: typeof params.apiProvider === "string" ? params.apiProvider : "TaoStats",
    loaderVersion: typeof params.loaderVersion === "string" ? params.loaderVersion : "",
    params: normalizedParams,
    ...normalizedParams,
    ...runtimeConfig,
  })

  if (runtimeConfig.runsInWidget) {
    Script.setWidget(widget)
  } else {
    await widget.presentLarge()
  }
  Script.complete()
  return widget
}

async function promptForStandaloneInput({
  defaultApiKey = "",
  requiredParamName = "",
  defaultRequiredParam = "",
  defaultMessage = "",
} = {}) {
  const alert = new Alert()
  alert.title = "Template Widget Input"
  alert.message = "Direct run mode: provide API key and optional parameters."
  alert.addTextField("API key (optional)", String(defaultApiKey || ""))
  alert.addTextField("message (optional demo)", String(defaultMessage || ""))
  if (requiredParamName) {
    alert.addTextField(`${requiredParamName} (required)`, String(defaultRequiredParam || ""))
  }
  alert.addAction("Run")
  alert.addCancelAction("Cancel")
  const selected = await alert.presentAlert()
  if (selected === -1) {
    return null
  }

  const apiKey = alert.textFieldValue(0).trim()
  const message = alert.textFieldValue(1).trim()
  const requiredParam = requiredParamName ? alert.textFieldValue(2).trim() : ""
  if (requiredParamName && !requiredParam) {
    throw new Error(`"${requiredParamName}" is required for this widget.`)
  }
  return { apiKey, message, requiredParam }
}

module.exports = {
  launch,
  widgetParameter,
  supportedFamilies,
  createWidget,
}

// Dev-only standalone entrypoint for Scriptable.
if (typeof Script !== "undefined") {
  ;(async () => {
    try {
      await launch({
        config: typeof config !== "undefined" ? config : {},
        args: typeof args !== "undefined" ? args : {},
        debug: true,
      })
    } catch (error) {
      const errorWidget = new ListWidget()
      errorWidget.backgroundColor = Color.black()
      const text = errorWidget.addText(`Error: ${error?.message || String(error)}`)
      text.textColor = Color.red()
      Script.setWidget(errorWidget)
      await errorWidget.presentSmall()
      Script.complete()
    }
  })()
}
