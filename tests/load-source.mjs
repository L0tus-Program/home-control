import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Compila o TypeScript real com as dependências locais, sem gerar arquivos no projeto. */
export async function loadSource(relativePath, mocks = {}) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../${relativePath}`, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    banner: { js: 'import { createRequire as testCreateRequire } from "node:module"; const require = testCreateRequire(import.meta.url);' },
    plugins: [{
      name: 'dependencias-de-teste',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'mock' } : undefined)
        build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path] }))
      }
    }]
  })
  const directory = mkdtempSync(join(tmpdir(), 'home-control-source-'))
  const path = join(directory, 'source.mjs')
  try {
    writeFileSync(path, result.outputFiles[0].text)
    return await import(pathToFileURL(path).href)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
