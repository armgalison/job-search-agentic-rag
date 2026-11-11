/**
 * electron-builder beforePack hook: makes sure the native binaries for the TARGET platform are present before
 * packaging. Needed when building Windows from Linux/WSL: npm only installs `sharp`'s binary for the host OS,
 * and any later `npm install` prunes a manually added one. A build without it fails at runtime when the local
 * embedding model loads ("Could not load the sharp module using the win32-x64 runtime").
 */
const { execSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const ARCH = { 1: 'x64', 3: 'arm64' } // electron-builder Arch enum

exports.default = async function beforePack(context) {
  const platform = context.electronPlatformName // 'win32' | 'linux' | 'darwin'
  const arch = ARCH[context.arch] ?? 'x64'
  const root = context.packager.projectDir
  const sharpVersion = JSON.parse(readFileSync(join(root, 'node_modules/sharp/package.json'), 'utf8')).version
  const pkg = `@img/sharp-${platform}-${arch}`
  const dir = join(root, 'node_modules', pkg)

  if (!existsSync(dir)) {
    console.log(`  • before-pack: installing ${pkg}@${sharpVersion} for the ${platform}-${arch} target`)
    execSync(`npm install --no-save --force ${pkg}@${sharpVersion}`, { cwd: root, stdio: 'inherit' })
  }

  const required = [
    [dir, `${pkg} (sharp, needed by the local embedding model)`],
    [join(root, 'node_modules/better-sqlite3/prebuilds', `${platform}-${arch}.node`), `better-sqlite3 ${platform}-${arch} prebuild`],
    [join(root, 'node_modules/onnxruntime-node/bin/napi-v6', platform, arch), `onnxruntime-node ${platform}/${arch} binary`]
  ]
  const missing = required.filter(([p]) => !existsSync(p)).map(([, name]) => name)
  if (missing.length) throw new Error(`Native binaries missing for ${platform}-${arch}: ${missing.join(', ')}`)
  console.log(`  • before-pack: native binaries for ${platform}-${arch} verified`)
}
