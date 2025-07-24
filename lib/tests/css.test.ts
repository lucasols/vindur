import { dedent } from '@ls-stack/utils/dedent'
import { describe, expect, test } from 'vitest'
import { transform } from '../src/transform'

describe('css', () => {
  test('should transform css styles', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        background-color: red;
      \`

      console.log(style)
    `

    const result = transform({
      source,
      filePath: '/src/test.ts',
    })

    expect(result.css).toMatchInlineSnapshot(`
      ".cmcre00-1 {
      background-color: red;
      }"
    `)

    expect(result.code).toMatchInlineSnapshot(`"const style = "cmcre00-1";
console.log(style);"`)
  })

  test('should transform css styles in dev mode with variable names', () => {
    const source = dedent`
      import { css } from 'vindur'

      const buttonStyle = css\`
        padding: 10px;
        color: blue;
      \`

      const headerStyle = css\`
        font-size: 24px;
        font-weight: bold;
      \`

      console.log(buttonStyle, headerStyle)
    `

    const result = transform({
      source,
      filePath: '/src/components.ts',
      dev: true,
    })

    expect(result.css).toMatchInlineSnapshot(`
      ".ccixwtu-1-buttonStyle {
      padding: 10px;
        color: blue;
      }

      .ccixwtu-2-headerStyle {
      font-size: 24px;
        font-weight: bold;
      }"
    `)

    expect(result.code)
      .toMatchInlineSnapshot(`"const buttonStyle = "ccixwtu-1-buttonStyle";
const headerStyle = "ccixwtu-2-headerStyle";
console.log(buttonStyle, headerStyle);"`)
  })
})
