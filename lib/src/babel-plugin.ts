import type { PluginObj } from '@babel/core'
import { murmur2 } from '@ls-stack/utils/hash'

export interface VindurPluginOptions {
  dev?: boolean
  filePath: string
}

export interface VindurPluginState {
  cssRules: string[]
}

export function createVindurPlugin(
  options: VindurPluginOptions,
  state: VindurPluginState
): PluginObj {
  const { dev = false, filePath } = options

  // Generate base hash from file path with 'c' prefix
  const fileHash = `c${murmur2(filePath)}`
  let classIndex = 1

  return {
    name: 'vindur-css-transform',
    visitor: {
      VariableDeclarator(path) {
        // Check if this is a css tagged template assignment
        if (
          path.node.init &&
          path.node.init.type === 'TaggedTemplateExpression' &&
          path.node.init.tag.type === 'Identifier' &&
          path.node.init.tag.name === 'css' &&
          path.node.id.type === 'Identifier'
        ) {
          const varName = path.node.id.name
          const cssContent = path.node.init.quasi.quasis[0]?.value.raw || ''

          // Generate class name based on dev mode
          const className = dev
            ? `${fileHash}-${classIndex}-${varName}`
            : `${fileHash}-${classIndex}`
          classIndex++

          // Store the CSS rule
          state.cssRules.push(`.${className} {\n${cssContent.trim()}\n}`)

          // Replace the tagged template with the class name string
          path.node.init = {
            type: 'StringLiteral',
            value: className,
          }
        }
      },
      TaggedTemplateExpression(path) {
        if (
          path.node.tag.type === 'Identifier' &&
          path.node.tag.name === 'css'
        ) {
          const cssContent = path.node.quasi.quasis[0]?.value.raw || ''

          // Generate class name with hash and index (no varName for direct usage)
          const className = `${fileHash}-${classIndex}`
          classIndex++

          // Store the CSS rule
          state.cssRules.push(`.${className} {\n${cssContent.trim()}\n}`)

          // Replace the tagged template with the class name string
          path.replaceWith({
            type: 'StringLiteral',
            value: className,
          })
        }
      },
    },
    pre() {
      state.cssRules.length = 0
      classIndex = 1
    },
  }
}
