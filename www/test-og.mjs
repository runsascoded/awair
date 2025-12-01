#!/usr/bin/env node
/**
 * Wrapper script for testing OG image generation.
 * Supports both Docker (Lambda-like) and local testing modes.
 *
 * Usage:
 *   ./test-og.mjs [options] [url]
 *   pnpm test:og               # Test localhost in Docker
 *   pnpm test:og:prod          # Test production in Docker
 *   pnpm test:og:local         # Test localhost (host mode, for debugging)
 *
 * Options:
 *   --docker         Run in Docker (Lambda-like environment, default)
 *   --local          Run on host (macOS/Linux native, for debugging only)
 *   -o, --output     Output file path (default: /tmp/og-test.jpg)
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse arguments
const args = process.argv.slice(2)
const useDocker = !args.includes('--local')
const dockerArgIndex = args.indexOf('--docker')
if (dockerArgIndex !== -1) args.splice(dockerArgIndex, 1)
const localArgIndex = args.indexOf('--local')
if (localArgIndex !== -1) args.splice(localArgIndex, 1)

// Find og-lambda directory (source or node_modules)
let ogLambdaDir = join(__dirname, '..', '..', 'js', 'og-lambda')
if (!existsSync(ogLambdaDir)) {
  const nodeModulesPath = join(__dirname, 'node_modules', '.pnpm')
  const ogLambdaDirs = readdirSync(nodeModulesPath)
    .filter(name => name.startsWith('@rdub+og-lambda'))

  if (ogLambdaDirs.length === 0) {
    console.error('Error: @rdub/og-lambda not found in node_modules or ../js/og-lambda')
    process.exit(1)
  }

  ogLambdaDir = join(
    nodeModulesPath,
    ogLambdaDirs[0],
    'node_modules',
    '@rdub',
    'og-lambda'
  )
}

if (useDocker) {
  // Docker mode: Build and run in Lambda-like environment
  const dockerfilePath = join(ogLambdaDir, 'Dockerfile.test')
  if (!existsSync(dockerfilePath)) {
    console.error('Error: Dockerfile.test not found at', dockerfilePath)
    process.exit(1)
  }

  console.log('Building Docker image...')
  try {
    execSync('docker build -f Dockerfile.test -t og-lambda-test .', {
      cwd: ogLambdaDir,
      stdio: 'inherit'
    })
  } catch (error) {
    console.error('Docker build failed')
    process.exit(1)
  }

  // Get host URL (use host.docker.internal on macOS)
  const isLocalhost = args.some(arg => arg.includes('localhost') || arg.includes('127.0.0.1'))
  let url = args.find(arg => arg.startsWith('http'))
  if (isLocalhost && url) {
    url = url.replace(/localhost|127\.0\.0\.1/, 'host.docker.internal')
  }

  // Extract output file
  const outputIndex = args.findIndex(arg => arg === '-o' || arg === '--output')
  let outputFile = outputIndex !== -1 ? args[outputIndex + 1] : 'og-test.jpg'

  // Convert relative paths to absolute paths in current directory
  let containerOutputFile = outputFile
  if (!outputFile.startsWith('/')) {
    const absolutePath = join(process.cwd(), outputFile)
    containerOutputFile = `/host${absolutePath}`
    outputFile = absolutePath
  }

  // Build docker run command with --no-open since Docker has no GUI
  const dockerArgs = [
    'run', '--rm',
    '-e', `SCREENSHOT_URL=${url || 'http://host.docker.internal:5173/?d=+br&y=thZ&og&t=-3d'}`,
    '-e', `OUTPUT_FILE=${containerOutputFile}`,
    '-e', 'PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium',
    '-v', `${process.cwd()}:/host${process.cwd()}`,
    '-v', '/tmp:/tmp',
    '--add-host=host.docker.internal:host-gateway',
    'og-lambda-test',
    'node', 'test-local.mjs', '--no-open'  // Override CMD to pass --no-open flag
  ]

  console.log('Running test in Docker...')
  try {
    execFileSync('docker', dockerArgs, { stdio: 'inherit' })
    console.log(`\nScreenshot saved to ${outputFile}`)
  } catch (error) {
    process.exit(error.status || 1)
  }
} else {
  // Local mode: Run on host (for debugging only)
  const testScriptPath = join(ogLambdaDir, 'test-local.mjs')
  if (!existsSync(testScriptPath)) {
    console.error('Error: test-local.mjs not found at', testScriptPath)
    process.exit(1)
  }

  console.log('Running in local mode (host environment, for debugging only)')
  try {
    execFileSync('node', [testScriptPath, ...args], { stdio: 'inherit' })
  } catch (error) {
    process.exit(error.status || 1)
  }
}
