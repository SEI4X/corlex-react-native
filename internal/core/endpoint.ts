/** HTTPS by default; a host-app development flag permits other HTTP endpoints explicitly. */
export function endpointAllowed(value: unknown, allowInsecureHttp = false): boolean {
  if (typeof value !== 'string' || value !== value.trim()) return false
  if (!/^https?:\/\/[^/\\]/i.test(value) || value.includes('\\')) return false
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 32 || code === 127) return false
  }
  try {
    const url = new URL(value)
    const authority = /^[a-z]+:\/\/([^/]+)/i.exec(value)?.[1] ?? ''
    if (
      url.username ||
      url.password ||
      authority.includes('@') ||
      value.includes('?') ||
      value.includes('#')
    )
      return false
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    const host = url.hostname.toLowerCase()
    return (
      allowInsecureHttp === true ||
      host === 'localhost' ||
      host === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(host) ||
      host === '10.0.2.2' ||
      host === '10.0.3.2'
    )
  } catch {
    return false
  }
}
