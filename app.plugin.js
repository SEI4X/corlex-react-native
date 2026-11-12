// Expo looks for this file in the package root: `plugins: ["@corlex/sdk-react-native"]`.
const plugin = require('./dist/plugin.cjs')

module.exports = plugin.default ?? plugin
