/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const rendererRoot = path.resolve('src/renderer/src')
const mainEntry = path.join(rendererRoot, 'main.tsx')
const uiRoots = ['components', 'layout', 'views', 'dev'].map((item) =>
  path.join(rendererRoot, item)
)
const sourceExtensions = new Set(['.ts', '.tsx'])
const allowedMainCssImports = new Set(['antd/dist/reset.css', './assets/styles/index.css'])
const legacyGlobalCss = new Set(['./assets/main.css', './assets/features.css'])
const legacyCssFiles = ['main.css', 'features.css'].map((file) =>
  path.join(rendererRoot, 'assets', file)
)

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

function cssImports(content) {
  return [...content.matchAll(/import\s+([^'"]+\s+from\s+)?['"]([^'"]+\.css)['"]/g)].map(
    (match) => match[2]
  )
}

const violations = []

for (const file of legacyCssFiles) {
  if (existsSync(file)) {
    violations.push(`${relative(file)}: legacy global CSS files must not be restored.`)
  }
}

for (const file of walk(rendererRoot)) {
  const content = readFileSync(file, 'utf8')
  const fileLabel = relative(file)
  const imports = cssImports(content)

  if (file === mainEntry) {
    for (const cssImport of imports) {
      if (!allowedMainCssImports.has(cssImport)) {
        violations.push(
          `${fileLabel}: main.tsx may only import antd reset and assets/styles/index.css.`
        )
      }
    }
    continue
  }

  for (const cssImport of imports) {
    if (legacyGlobalCss.has(cssImport)) {
      violations.push(`${fileLabel}: import assets/styles/index.css instead of legacy CSS files.`)
      continue
    }

    if (cssImport.includes('/assets/') || cssImport.startsWith('../assets/')) {
      violations.push(`${fileLabel}: renderer modules must not import global asset CSS directly.`)
      continue
    }

    if (isInRoots(file, uiRoots) && !cssImport.endsWith('.module.css')) {
      violations.push(`${fileLabel}: UI files may only import local CSS Modules.`)
    }
  }
}

if (violations.length > 0) {
  console.error('Renderer style boundary check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Renderer style boundary check passed.')
