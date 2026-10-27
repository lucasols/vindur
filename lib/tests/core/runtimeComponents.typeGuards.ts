type RenderedElement = { type: unknown; props: Record<string, unknown> };

type ForwardRefComponent = {
  render: (props: Record<string, unknown>, ref: null) => RenderedElement;
};

export function isForwardRefComponent(
  value: unknown,
): value is ForwardRefComponent {
  return (
    typeof value === 'object'
    && value !== null
    && 'render' in value
    && typeof value.render === 'function'
  );
}
