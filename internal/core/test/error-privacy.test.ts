import { expect, it } from 'vitest'
import { safeErrorReport } from '../error-privacy'
it('redacts the real upload-token prefix in opted-in text and safe frame fields', () => {
  const token = 'corlex_up_' + 'u'.repeat(43)
  const report = safeErrorReport(
    {
      name: 'Error',
      message: 'Upload failed ' + token,
      frames: [{ fn: token, file: token + '.js', line: 1 }],
    },
    true,
  )
  expect(JSON.stringify(report)).not.toContain(token)
  expect(report.frames).toEqual([{ fn: 'anonymous', line: 1 }])
  expect(report.message).toContain('[redacted]')
})
it.each([
  'AKIA' + 'A'.repeat(16),
  'eyJ' + 'a'.repeat(16) + '.' + 'b'.repeat(16) + '.' + 'c'.repeat(16),
])('redacts already-recognized credential classes from opted-in messages', (token) => {
  const report = safeErrorReport({ message: 'Request failed ' + token }, true)
  expect(report.message).not.toContain(token)
  expect(report.message).toContain('[redacted]')
})
