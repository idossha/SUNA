/**
 * Drive probe — ROADMAP item 5 / §20.6: a user who completes the wizard and
 * opens a notebook can run a cell.
 *
 * This is the end-to-end proof that the gap is closed, so it deliberately
 * does NOT stub the install: it walks the real wizard, takes the "Create with
 * uv" branch with the kernel offer checked, presses the real Create button,
 * then opens a notebook in the created project and executes a cell that
 * produces output. The assertion is the OUTPUT TEXT, because "the kernel went
 * idle" is exactly the kind of green that hides a broken runtime.
 *
 * It then proves the honest-failure half: an interpreter with no ipykernel
 * must produce a message that names the interpreter and the command, not a
 * crash and not a silent nothing.
 *
 *   1. wizard steps 1 → 6, choosing "Create with uv";
 *   2. step 4 offers the kernel install and defaults it ON for that branch;
 *   3. Create writes the project and provisions .venv WITH ipykernel;
 *   4. a notebook cell runs and its stdout comes back;
 *   5. a project whose selected interpreter has no ipykernel reports
 *      `no-jupyter-client` with an actionable message.
 *
 * Needs `uv` on PATH and a network for step 3 — it says so and stops rather
 * than failing obscurely.
 *
 * Run:  node scripts/e2e/drive.mjs --boot
 *       node scripts/e2e/drive.mjs run scripts/e2e/probes/notebook-kernel-onboarding.mjs
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

const NOTEBOOK = {
  cells: [
    {
      cell_type: 'code',
      id: 'k1',
      metadata: {},
      execution_count: null,
      source: 'print("kernel ran:", 6 * 7)\n',
      outputs: []
    }
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5
}

export default async (ctx) => {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore' })
  } catch {
    throw new Error('this probe needs `uv` on PATH — it drives the wizard\'s uv branch')
  }

  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'window.__sunaDev (dev build)' })

  const parent = mkdtempSync(join(tmpdir(), 'suna-kernel-probe-'))
  const projectDir = join(parent, 'kernel-paper')

  // ---- 1. walk the real wizard to step 6 ---------------------------------
  await ctx.evalJs(`window.__sunaDev.dock.clearDock()`)
  await ctx.sleep(300)
  await ctx.evalJs(`window.__sunaDev.dock.openOnboardingTab({ mode: 'create' })`)
  await ctx.waitFor(`window.__sunaDev.onboarding.isOpen()`, { desc: 'the wizard' })

  await ctx.evalJs(`window.__sunaDev.onboarding.patch({ parentDir: ${JSON.stringify(parent)} })`)
  await ctx.evalJs(`(() => {
    const el = document.querySelector('#onboard-name');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'kernel-paper');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await ctx.waitFor(`document.querySelector('.onboard__next')?.disabled === false`, {
    timeoutMs: 15000,
    desc: 'step 1 to validate the name'
  })

  // Next twice: 1 → 2 → 3 (Python environment).
  for (let i = 0; i < 2; i++) {
    await ctx.evalJs(`document.querySelector('.onboard__next').click()`)
    await ctx.sleep(600)
  }
  const onStep = await ctx.evalJs(`document.querySelector('.onboard__step-title')?.textContent`)
  assert(onStep === 'Python environment', `expected the Python step, got ${JSON.stringify(onStep)}`)

  // ---- 2. the uv branch, and the kernel offer it defaults on --------------
  await ctx.waitFor(`window.__sunaDev.onboarding.getState()?.uvAvailable === true`, {
    timeoutMs: 20000,
    desc: 'the uv probe to answer'
  })
  await ctx.evalJs(`(() => {
    const radios = [...document.querySelectorAll('input[name="onboard-python"]')];
    // Skip / existing / create-uv, in the order the step renders them.
    radios[2].click();
    return true;
  })()`)
  await ctx.sleep(400)

  const offer = await ctx.evalJs(`(() => {
    const s = window.__sunaDev.onboarding.getState();
    const box = document.querySelector('.onboard__step-page input[type="checkbox"]');
    return {
      choice: s?.pythonChoice ?? null,
      installKernel: s?.installKernel ?? null,
      checkboxShown: !!box,
      checkboxChecked: box ? box.checked : null,
      label: box?.closest('label')?.textContent ?? null
    };
  })()`)
  assert(offer.choice === 'create-uv', `the uv radio did not take: ${JSON.stringify(offer)}`)
  assert(offer.checkboxShown, 'step 4 offers no notebook-runtime checkbox on the uv branch')
  assert(
    offer.installKernel === true && offer.checkboxChecked === true,
    `the kernel offer is not on by default for the env SUNA creates: ${JSON.stringify(offer)}`
  )
  assert(/ipykernel/.test(offer.label ?? ''), `the offer does not name ipykernel: ${offer.label}`)

  // ---- 3. Create, and nothing before it ----------------------------------
  assert(!existsSync(projectDir), 'the wizard wrote the project before Create')
  for (let i = 0; i < 3; i++) {
    await ctx.evalJs(`document.querySelector('.onboard__next').click()`)
    await ctx.sleep(600)
  }
  const review = await ctx.evalJs(`document.querySelector('.onboard__step-title')?.textContent`)
  assert(review === 'Review', `expected Review, got ${JSON.stringify(review)}`)

  await ctx.evalJs(`document.querySelector('.onboard__create').click()`)
  // Watched ON DISK, not through the wizard's state: Create opens the new
  // project, which closes the wizard tab, so `onboarding.getState()` goes
  // null the moment it succeeds. The install needs a network and a cold uv
  // cache, so allow real time for it.
  await ctx.waitFor(
    () => (existsSync(join(projectDir, 'suna.json')) ? true : null),
    { timeoutMs: 300000, intervalMs: 1000, desc: 'Create project to write the project' }
  )
  // If a wizard tab is still up, it must not be sitting on an error or a
  // warning — a warning here is exactly how a failed install would surface.
  const wizardAfter = await ctx.evalJs(`(() => {
    const s = window.__sunaDev.onboarding.getState();
    return s === null ? null : { error: s.createError, warnings: s.createWarnings };
  })()`)
  if (wizardAfter !== null) {
    assert(wizardAfter.error === null, `the wizard errored: ${wizardAfter.error}`)
    assert(
      wizardAfter.warnings.length === 0,
      `the wizard warned: ${JSON.stringify(wizardAfter.warnings)}`
    )
  }

  const venvPython = join(projectDir, '.venv', 'bin', 'python')
  await ctx.waitFor(() => (existsSync(venvPython) ? true : null), {
    timeoutMs: 300000,
    intervalMs: 1000,
    desc: 'the uv environment'
  })
  // The install is what this probe exists to prove, so assert it directly and
  // not only through the notebook: `importable` is the claim SUNA makes.
  await ctx.waitFor(
    () => {
      try {
        execFileSync(venvPython, ['-c', 'import jupyter_client, ipykernel'], { stdio: 'ignore' })
        return true
      } catch {
        return null
      }
    },
    { timeoutMs: 600000, intervalMs: 2000, desc: 'ipykernel to be importable in the new env' }
  )

  // ---- 4. open a notebook in it and RUN A CELL ---------------------------
  await ctx.evalJs(`window.__sunaDev.openProjectAt(${JSON.stringify(projectDir)})`)
  await ctx.waitFor(
    `window.__sunaDev.projectStore.getState().rootDir === ${JSON.stringify(projectDir)}`,
    { timeoutMs: 30000, desc: 'the created project to open' }
  )

  // The env the wizard created must be the SELECTED one before a cell runs —
  // otherwise the kernel starts under the system python3 and fails in the very
  // environment onboarding just provisioned. The wizard selects it explicitly
  // for exactly this reason; assert that rather than racing it.
  const selected = await ctx.waitFor(
    `window.suna.invoke('env:selected', { dir: ${JSON.stringify(projectDir)} })
       .then((r) => r.envPath)`,
    { timeoutMs: 30000, intervalMs: 500, desc: 'the created env to be selected' }
  )
  assert(
    selected === join(projectDir, '.venv'),
    `the wizard did not select the env it created: ${JSON.stringify(selected)}`
  )

  const nbPath = join(projectDir, 'probe_kernel.ipynb')
  writeFileSync(nbPath, `${JSON.stringify(NOTEBOOK, null, 1)}\n`)
  await ctx.evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(nbPath)})`)
  await ctx.waitFor(`document.querySelectorAll('.nb-cell').length === 1`, {
    timeoutMs: 20000,
    desc: 'the notebook tab'
  })

  await ctx.evalJs(`[...document.querySelectorAll('.nb-toolbar__button')]
    .find((b) => b.textContent.trim() === 'Run all').click()`)

  const outputText = await ctx.waitFor(
    `(() => {
      const fault = document.querySelector('.nb-fault__message');
      if (fault) throw new Error('kernel fault: ' + fault.textContent);
      const out = document.querySelector('.nb-cell .nb-output');
      const text = out?.textContent ?? '';
      return text.includes('kernel ran:') ? text.trim() : null;
    })()`,
    { timeoutMs: 180000, intervalMs: 1000, desc: 'the cell to produce output' }
  )
  assert(
    /kernel ran:\s*42/.test(outputText),
    `the cell ran but printed something else: ${JSON.stringify(outputText)}`
  )
  console.log('  cell output:', JSON.stringify(outputText))

  // ---- 5. the honest-failure path ----------------------------------------
  // A SECOND project whose selected interpreter has no ipykernel — the case
  // no wizard step can cover, since the interpreter is a per-project pick the
  // user can change at any time and projects also arrive by clone. It is a
  // copy of the real project (so its suna.json is a real one) with the
  // provisioned env swapped for an empty one.
  const bareProject = join(parent, 'bare-paper')
  cpSync(projectDir, bareProject, { recursive: true })
  rmSync(join(bareProject, '.venv'), { recursive: true, force: true })
  rmSync(join(bareProject, '.git'), { recursive: true, force: true })
  execFileSync('uv', ['venv', join(bareProject, '.venv')], { stdio: 'ignore' })
  const bareEnv = join(bareProject, '.venv')
  assert(existsSync(join(bareEnv, 'bin', 'python')), 'the bare venv has no interpreter')

  await ctx.evalJs(`window.__sunaDev.dock.clearDock()`)
  await ctx.sleep(400)
  await ctx.evalJs(`window.__sunaDev.openProjectAt(${JSON.stringify(bareProject)})`)
  await ctx.waitFor(
    `window.__sunaDev.projectStore.getState().rootDir === ${JSON.stringify(bareProject)}`,
    { timeoutMs: 30000, desc: 'the bare project to open' }
  )
  await ctx.waitFor(
    `window.suna.invoke('env:selected', { dir: ${JSON.stringify(bareProject)} })
       .then((r) => r.envPath === ${JSON.stringify(bareEnv)})`,
    { timeoutMs: 60000, intervalMs: 500, desc: 'the bare env to be selected' }
  )
  await ctx.sleep(800)

  const barePath = join(bareProject, 'bare.ipynb')
  writeFileSync(barePath, `${JSON.stringify(NOTEBOOK, null, 1)}\n`)
  await ctx.evalJs(`window.__sunaDev.openFileTab(${JSON.stringify(barePath)})`)
  await ctx.waitFor(`document.querySelectorAll('.nb-cell').length === 1`, {
    timeoutMs: 20000,
    desc: 'the bare-env notebook tab'
  })
  await ctx.evalJs(`[...document.querySelectorAll('.nb-toolbar__button')]
    .find((b) => b.textContent.trim() === 'Run all').click()`)

  const fault = await ctx.waitFor(
    `(() => {
      const el = document.querySelector('.nb-fault');
      if (!el) return null;
      const button = el.querySelector('.nb-fault__action');
      return {
        message: el.querySelector('.nb-fault__message')?.textContent ?? '',
        action: button ? button.textContent : null
      };
    })()`,
    { timeoutMs: 120000, intervalMs: 1000, desc: 'the no-kernel fault panel' }
  )
  assert(
    fault.message.includes('jupyter_client') && fault.message.includes(bareEnv),
    `the failure does not name the interpreter it failed under: ${JSON.stringify(fault.message)}`
  )
  assert(
    fault.message.includes('pip install ipykernel'),
    `the failure does not name the command: ${JSON.stringify(fault.message)}`
  )
  assert(
    fault.action !== null && fault.action.includes(bareEnv),
    `no one-click repair naming the env: ${JSON.stringify(fault.action)}`
  )
  console.log('  fault message:', JSON.stringify(fault.message))
  console.log('  repair button:', JSON.stringify(fault.action))

  // ---- 6. the repair button actually repairs -----------------------------
  // Offering a fix that does not fix anything would be worse than the plain
  // message, so the button is driven, not just asserted to exist.
  await ctx.evalJs(`document.querySelector('.nb-fault__action').click()`)
  // The install runs, then the panel restarts the kernel: the fault clears.
  await ctx.waitFor(
    `document.querySelector('.nb-fault') === null &&
     /idle|busy/.test(document.querySelector('.nb-toolbar__kernel')?.textContent ?? '')`,
    { timeoutMs: 600000, intervalMs: 1000, desc: 'the repair to bring a kernel up' }
  ).catch(async () => {
    const still = await ctx.evalJs(`document.querySelector('.nb-fault')?.textContent ?? null`)
    throw new Error(`the repair button did not produce a working kernel: ${still}`)
  })
  await ctx.evalJs(`[...document.querySelectorAll('.nb-toolbar__button')]
    .find((b) => b.textContent.trim() === 'Run all').click()`)
  const repaired = await ctx.waitFor(
    `(() => {
      const out = document.querySelector('.nb-cell .nb-output');
      const text = out?.textContent ?? '';
      return text.includes('kernel ran:') ? text.trim() : null;
    })()`,
    { timeoutMs: 180000, intervalMs: 1000, desc: 'the repaired kernel to run the cell' }
  )
  assert(/kernel ran:\s*42/.test(repaired), `after repair the cell printed: ${repaired}`)
  console.log('  after repair:', JSON.stringify(repaired))

  rmSync(parent, { recursive: true, force: true })
  console.log('notebook-kernel-onboarding: OK')
}
