// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: chart-line;

const supportedFamilies = ["small", "medium", "large"]
const widgetParameter = "addresses"

async function createWidget({
  addresses = "",
  params = {},
} = {}) {
  const value =
    typeof addresses === "string" && addresses.trim()
      ? addresses.trim()
      : typeof params.addresses === "string" && params.addresses.trim()
        ? params.addresses.trim()
        : ""

  const addressCount = value
    ? value.split(/[\n, ]+/).map((v) => v.trim()).filter(Boolean).length
    : 0

  const widget = new ListWidget()
  widget.backgroundColor = Color.black()

  const title = widget.addText("Portfolio Widget")
  title.textColor = Color.white()
  title.font = Font.boldSystemFont(14)
  title.centerAlignText()

  widget.addSpacer(6)
  const status = widget.addText(
    addressCount > 0
      ? `Configured addresses: ${addressCount}`
      : "No addresses configured.",
  )
  status.textColor = Color.lightGray()
  status.font = Font.systemFont(11)
  status.centerAlignText()

  return widget
}

module.exports = {
  supportedFamilies,
  widgetParameter,
  createWidget,
}
