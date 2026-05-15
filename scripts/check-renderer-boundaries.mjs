/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const rendererRoot = path.resolve('src/renderer/src')
const uiRoots = ['components', 'layout', 'views', 'dev'].map((item) =>
  path.join(rendererRoot, item)
)
const sourceExtensions = new Set(['.ts', '.tsx'])

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

const rendererFiles = walk(rendererRoot)
const violations = []
const directStoreImport = /from\s+['"][^'"]*store(?:\/[^'"]*)?['"]/g
const fullStoreSubscription = /\buse[A-Za-z]+Store\s*\(\s*\)/g
const inlineStoreSelector = /\buse[A-Za-z]+Store\s*\(\s*\(?\s*state\s*\)?\s*=>/g

for (const file of rendererFiles) {
  const content = readFileSync(file, 'utf8')
  const fileLabel = relative(file)

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

  directStoreImport.lastIndex = 0
  fullStoreSubscription.lastIndex = 0
  inlineStoreSelector.lastIndex = 0
}

if (violations.length > 0) {
  console.error('Renderer boundary check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Renderer boundary check passed.')
