import * as babel from '@babel/core'
import { createVindurPlugin, type VindurPluginState } from './babel-plugin'

type Result = {
  css: string
  styleDependencies: string[]
  code: string
}

export function transform({
  filePath,
  source,
  dev = false,
}: {
  filePath: string
  source: string
  dev?: boolean
}): Result {
  const pluginState: VindurPluginState = {
    cssRules: [],
    vindurImports: new Set<string>()
  }
  
  const plugin = createVindurPlugin({ filePath, dev }, pluginState)

  const result = babel.transformSync(source, {
    plugins: [plugin],
    parserOpts: {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    },
  })

  if (!result?.code) {
    throw new Error('Transform failed')
  }

  return {
    css: pluginState.cssRules.join('\n\n'),
    styleDependencies: [],
    code: result.code,
  }
}
