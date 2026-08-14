import { mkdir, rename, writeFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Write a source-of-truth file atomically: temp file in the same directory,
 * then rename over the target. A crash mid-write can never leave a truncated
 * manuscript.json / comments.json behind.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temp, data)
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}
