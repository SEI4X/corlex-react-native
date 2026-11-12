import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const plugin = createRequire(import.meta.url)('../app.plugin.js')
assert.equal(typeof plugin, 'function', 'Packed Expo config plugin must be callable')
console.log('Expo CommonJS config plugin is callable')
