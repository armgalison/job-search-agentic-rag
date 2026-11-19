import { existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { app } from 'electron'

/** Folder of the job-agent Claude Code plugin (skills). Shipped as an extra resource in packaged builds. */
export function pluginDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'agent-plugin') : join(app.getAppPath(), 'agent-plugin')
}

/** Working directory of agent runs (empty apart from what the agent writes; no CLAUDE.md, no settings). */
export const agentWorkspace = (): string => join(app.getPath('userData'), 'agent-workspace')

/** Resume / cover letter files the agent's browser uploads, per job. */
export const agentFilesDir = (jobId: number): string => join(agentWorkspace(), 'files', `job-${jobId}`)

/** Persistent browser profile for Playwright, so the LinkedIn login survives between runs. */
export const browserProfileDir = (): string => join(app.getPath('userData'), 'agent-browser')

/**
 * Playwright MCP's CLI script. In packaged builds it is unpacked from the asar archive (electron-builder asarUnpack),
 * because it runs as a separate Node process (Electron with ELECTRON_RUN_AS_NODE=1).
 */
export function playwrightMcpCli(): string {
  const pkg = require.resolve('@playwright/mcp/package.json')
  const cli = join(dirname(pkg), 'cli.js')
  const unpacked = cli.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
  return existsSync(unpacked) ? unpacked : cli
}
