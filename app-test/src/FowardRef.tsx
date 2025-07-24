import { forwardRef } from 'react'

export const ForwardRef = forwardRef(({ json }: { json: any }, ref) => {
  return <div ref={ref as any}>ForwardRef: {JSON.stringify(json)}</div>
})
