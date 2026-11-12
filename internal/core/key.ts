/** Only event-write SDK credentials belong in the SDK; never send MCP, upload or AI keys. */
export function isSdkKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 51 &&
    /^ck_(?:live|test)_[0-9A-Za-z]{43}$/.test(value)
  )
}
