import { getBundledProfile, type BundledProfileId } from '@suna/formatter'
import type { ExportOptions } from '@suna/core'
import { useManuscriptStore } from '../state/manuscript'
import { rasterizeManuscriptFigures } from './rasterizeFigures'

/**
 * Dev-only seam for e2e drivers (ARCHITECTURE §13).
 *
 * `export:pdf` prints through a hidden `BrowserWindow`'s `printToPDF`, so the
 * only way to produce real PDF bytes is to ask the *running* app for them —
 * which is why the PDF half of export went unverified for so long while the
 * DOCX half was asserted down to `word/document.xml` (ROADMAP, "Known broken").
 *
 * A driver cannot reach the export page's own button: the format/profile
 * controls are React `<select>`s and the compliance gate sits in front of the
 * click, so a probe driving the UI would be testing the dialog, not the
 * printer. What it needs instead is the one step it genuinely cannot do from
 * Node — **rasterizing the figures**, which happens on an offscreen canvas in
 * the renderer ('figure:export' throws by design for 'png' because main has no
 * canvas). Everything after that is the IPC contract in `packages/core/ipc.ts`,
 * which the probe would only be re-stating.
 *
 * So this seam is deliberately thin: real manuscript, real profile, the real
 * rasterizer, the real channel. It is NOT a second export path — it builds the
 * same request `ExportDialog.exportOnce` builds and hands it to the same
 * handler. Anything it did differently would be a lie about what ships.
 */
export const exportDevSeam = {
  /**
   * Export the working-copy manuscript under `profileId` and return the
   * handler's response (`{ path, oversized }` for PDF/DOCX).
   *
   * Figures are rasterized UNCOMPRESSED — the submission copy — because a
   * probe asserting that a figure reached the page should assert the bytes a
   * journal would receive, not the emailing-a-draft variant.
   */
  async exportManuscript(
    rootDir: string,
    profileId: BundledProfileId,
    format: 'pdf' | 'docx' | 'html',
    outputName: string,
    options: Partial<ExportOptions> = {}
  ): Promise<{ path: string }> {
    const manuscript = useManuscriptStore.getState().manuscript
    if (manuscript === null) throw new Error('no manuscript.json loaded in this project')
    const profile = getBundledProfile(profileId)
    // Refuse rather than guess (D2): a driver naming a profile that is not
    // bundled should hear that, not silently get the house style's page setup
    // and a green check about a profile that never applied.
    if (profile === null) throw new Error(`no bundled profile '${profileId}'`)
    const figurePngPaths = await rasterizeManuscriptFigures(rootDir, manuscript, profile, {
      compress: false
    })
    const request = {
      dir: rootDir,
      profileId,
      outputName,
      figurePngPaths,
      options: { doubleSpacing: false, lineNumbers: false, pageNumbers: true, ...options },
      target: 'manuscript' as const
    }
    if (format === 'pdf') return await window.suna.invoke('export:pdf', request)
    if (format === 'docx') return await window.suna.invoke('export:docx', request)
    return await window.suna.invoke('export:html', request)
  }
}
