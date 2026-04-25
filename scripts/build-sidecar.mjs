import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const rootDir = process.cwd()
const sidecarDir = join(rootDir, 'sidecar')
const binaryName = process.platform === 'win32' ? 'intelligit-sidecar.exe' : 'intelligit-sidecar'
const outputPath = join(rootDir, 'resources', binaryName)

if (process.env.INTELLIGIT_SKIP_SIDECAR_BUILD === '1') {
  if (existsSync(outputPath)) {
    console.warn(`[build:sidecar] Skipping Go build; using existing ${outputPath}`)
    process.exit(0)
  }

  console.error('[build:sidecar] Sidecar build was skipped, but no sidecar binary exists in resources/.')
  process.exit(1)
}

const goVersion = spawnSync('go', ['version'], { stdio: 'ignore' })

if (goVersion.error || goVersion.status !== 0) {
  if (existsSync(outputPath)) {
    console.warn(`[build:sidecar] Go was not found; using existing ${outputPath}`)
    process.exit(0)
  }

  console.error('[build:sidecar] Go was not found and no sidecar binary exists in resources/.')
  console.error('[build:sidecar] Install Go or add a prebuilt sidecar binary before running the app.')
  process.exit(1)
}

const result = spawnSync(
  'go',
  ['build', '-o', outputPath, './cmd/sidecar'],
  {
    cwd: sidecarDir,
    stdio: 'inherit'
  }
)

if (result.error) {
  console.error(`[build:sidecar] Failed to start Go build: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
