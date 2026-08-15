/**
 * Decode base64 (as returned by the `fs:read-binary` IPC channel) into raw
 * bytes for `pdfjs-dist`'s `getDocument({ data })`. `atob` is a standard
 * global in both the renderer and Node/vitest, so this stays a plain,
 * dependency-free, unit-testable function.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
