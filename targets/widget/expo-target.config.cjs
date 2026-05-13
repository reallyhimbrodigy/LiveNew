/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "LiveNewWidget",
  displayName: "LiveNew",
  icon: "../../assets/icon.png",
  colors: {
    $accent: "#c4a86c",
    widgetBackground: { color: "#faf5ec", darkColor: "#0f0d0a" },
    widgetForeground: { color: "#2a2620", darkColor: "#e8e0d4" },
  },
  deploymentTarget: "15.1",
  frameworks: ["SwiftUI", "WidgetKit"],
  entitlements: {
    "com.apple.security.application-groups": ["group.app.livenew.mobile"],
  },
});
