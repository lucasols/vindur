import { dedent } from '@ls-stack/utils/dedent'
import { describe, expect, test } from 'vitest'
import { transform } from '../src/transform'

describe('css', () => {
  test('should transform css styles', () => {
    const source = dedent`
      const style = css\`
        background-color: red;
      \`

      console.log(style)
    `

    const result = transform({
      source,
      fileId: 'src/test.ts',
    })

    expect(result.css).toMatchInlineSnapshot(`
      .hash-1 {
        background-color: red;
      }
    `)

    expect(result.code).toMatchInlineSnapshot(`
      "const style = 'hash-1';

      console.log(style)
    `)
  })
})
