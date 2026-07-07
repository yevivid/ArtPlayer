import path from 'node:path'
import { build as viteBuild } from 'vite'
import { getGlobalName, getProjects, getViteBuildConfig } from './utils.js'

const projects = getProjects()
const name = 'artplayer-plugin-auto-thumbnail'
const projectPath = projects[name]
const uncompiledPath = path.resolve(`docs/uncompiled/${name}`)
const entryFile = path.join(projectPath, 'src/index.js')

async function build() {
  console.log(`[${name}] Building...`)
  const startTime = Date.now()

  const config = getViteBuildConfig({
    entry: entryFile,
    outDir: uncompiledPath,
    name: getGlobalName(name),
    format: 'iife',
    fileName: 'index.js',
    minify: false,
    emptyOutDir: true,
  })
  config.define['process.env.NODE_ENV'] = JSON.stringify('development')

  await viteBuild({ root: projectPath, ...config })
  console.log(`[${name}] Built in ${Date.now() - startTime}ms`)
}

build().catch(console.error)
