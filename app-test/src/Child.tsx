/* eslint react-compiler/react-compiler: ["error"] */

import { ForwardRef } from './FowardRef'

export const Child = ({
  test,
  onClick,
}: {
  test: Record<string, any>
  onClick: () => void
}) => {
  return (
    <div onClick={onClick}>
      Test Obj JSON {JSON.stringify(test)}
      <ForwardRef json={test} />
    </div>
  )
}
