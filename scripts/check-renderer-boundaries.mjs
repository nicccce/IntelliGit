/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const rendererRoot = path.resolve('src/renderer/src')
const appEntry = path.join(rendererRoot, 'App.tsx')
const devRoot = path.join(rendererRoot, 'dev')
const rootMainAppEntry = path.join(rendererRoot, 'MainApp.tsx')
const uiRoots = ['components', 'layout', 'views', 'dev'].map((item) =>
  path.join(rendererRoot, item)
)
const sourceExtensions = new Set(['.ts', '.tsx'])
const rawInvokeGitAllowedFiles = new Set([
  path.join(rendererRoot, 'api', 'gitClient.ts'),
  path.join(rendererRoot, 'dev', 'SidecarTestPanel', 'sidecarTestClient.ts')
])

function walk(dir) {
  const entries = readdirSync(dir)
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) return walk(fullPath)
    return sourceExtensions.has(path.extname(fullPath)) ? [fullPath] : []
  })
}

function isInRoots(file, roots) {
  return roots.some((root) => file === root || file.startsWith(`${root}${path.sep}`))
}

function relative(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, '/')
}

function importSources(content) {
  return [...content.matchAll(/import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g)].map(
    (match) => match[1]
  )
}

function resolvesToDevImport(file, source) {
  if (!source.startsWith('.')) return false

  const resolved = path.resolve(path.dirname(file), source)
  return resolved === devRoot || resolved.startsWith(`${devRoot}${path.sep}`)
}

const rendererFiles = walk(rendererRoot)
const violations = []
const directStoreImport = /from\s+['"][^'"]*store(?:\/[^'"]*)?['"]/g
const fullStoreSubscription = /\buse[A-Za-z]+Store\s*\(\s*\)/g
const inlineStoreSelector = /\buse[A-Za-z]+Store\s*\(\s*\(?\s*state\s*\)?\s*=>/g
const rawInvokeGit = /\bwindow\.electronAPI\.invokeGit\s*\(/g

if (existsSync(rootMainAppEntry)) {
  violations.push(
    `${relative(rootMainAppEntry)}: app entry must live in src/renderer/src/app/MainApp.tsx, without a root-level re-export.`
  )
}

for (const file of rendererFiles) {
  const content = readFileSync(file, 'utf8')
  const fileLabel = relative(file)

  if (
    file !== appEntry &&
    !isInRoots(file, [devRoot]) &&
    importSources(content).some((source) => resolvesToDevImport(file, source))
  ) {
    violations.push(`${fileLabel}: only App.tsx may import dev-only renderer modules.`)
  }

  if (isInRoots(file, uiRoots) && directStoreImport.test(content)) {
    violations.push(`${fileLabel}: UI files must use viewModels instead of importing store.`)
  }

  if (fullStoreSubscription.test(content)) {
    violations.push(`${fileLabel}: store hooks must use explicit selectors.`)
  }

  if (inlineStoreSelector.test(content)) {
    violations.push(
      `${fileLabel}: move inline store selectors to src/renderer/src/store/selectors.`
    )
  }

  if (rawInvokeGit.test(content) && !rawInvokeGitAllowedFiles.has(file)) {
    violations.push(
      `${fileLabel}: raw invokeGit is only allowed in api/gitClient.ts and dev/SidecarTestPanel/sidecarTestClient.ts.`
    )
  }

  directStoreImport.lastIndex = 0
  fullStoreSubscription.lastIndex = 0
  inlineStoreSelector.lastIndex = 0
  rawInvokeGit.lastIndex = 0
}

if (violations.length > 0) {
  console.error('Renderer boundary check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Renderer boundary check passed.')
