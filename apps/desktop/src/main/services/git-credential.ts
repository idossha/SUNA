import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRemoteUrl } from './git-remote'
import { githubToken } from './github-auth'

/* ---------------------------------------------------------------------------
   Letting an HTTPS remote authenticate from the GitHub sign-in.

   SSH stays the default — it needs no token at push time and it is what a
   long-lived shared repository should use. But a co-author who has never
   generated an SSH key should not have to before their first push, and once
   they have signed in with GitHub, SUNA already holds a credential that works
   over HTTPS. This bridges the two.

   The token is passed to git through GIT_ASKPASS: a tiny script that prints
   one environment variable. Deliberately NOT through the remote URL (which
   would write the token into .git/config, where it outlives the session and
   gets shared by anyone who copies the repo) and NOT through `-c
   http.extraHeader` (which puts it in the process argument list, world-
   readable on Linux). The environment of one child process is the narrowest
   channel of the three.
   --------------------------------------------------------------------------- */

/** Env var the askpass script echoes. Read by nothing else. */
const TOKEN_VAR = 'SUNA_GIT_TOKEN'

let askpassPath: string | null = null

/**
 * Write the askpass helper once per run and reuse it.
 *
 * git asks for a username and then a password; GitHub accepts the token in
 * either position, so the script can answer both prompts identically and stay
 * a single line — which is also what makes the Windows variant trivial.
 */
async function askpassScript(): Promise<string> {
  if (askpassPath !== null) return askpassPath
  const dir = await mkdtemp(join(tmpdir(), 'suna-askpass-'))
  if (process.platform === 'win32') {
    const file = join(dir, 'askpass.bat')
    await writeFile(file, `@echo off\r\n<nul set /p=%${TOKEN_VAR}%\r\n`, 'utf8')
    askpassPath = file
    return file
  }
  const file = join(dir, 'askpass.sh')
  await writeFile(file, `#!/bin/sh\nprintf '%s' "$${TOKEN_VAR}"\n`, 'utf8')
  await chmod(file, 0o700)
  askpassPath = file
  return file
}

/** Hosts the GitHub token is allowed to authenticate to. */
function isGitHubHost(host: string | null): boolean {
  return host === 'github.com' || host === 'www.github.com'
}

/**
 * Extra environment for a network git command against `url`, or undefined
 * when nothing extra is needed.
 *
 * Returns undefined for SSH remotes (the key does the work), for non-GitHub
 * hosts (the token would be sent somewhere it does not belong), and when
 * nobody is signed in.
 */
export async function remoteAuthEnv(url: string | null): Promise<NodeJS.ProcessEnv | undefined> {
  if (url === null || url === '') return undefined
  const parsed = parseRemoteUrl(url)
  if (parsed.protocol !== 'https') return undefined
  if (!isGitHubHost(parsed.host)) return undefined

  const token = await githubToken()
  if (token === null) return undefined

  return {
    [TOKEN_VAR]: token,
    GIT_ASKPASS: await askpassScript(),
    // git prefers SSH_ASKPASS/GUI prompts in some builds; force the terminal
    // path off so the only answer it can get is ours.
    GIT_TERMINAL_PROMPT: '0'
  }
}

/**
 * Whether an HTTPS remote could authenticate right now — what the panel needs
 * to decide between "Publish" and "set up SSH first".
 */
export async function canAuthenticateHttps(url: string | null): Promise<boolean> {
  return (await remoteAuthEnv(url)) !== undefined
}
