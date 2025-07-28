/* eslint react-compiler/react-compiler: ["error"] */

export const Child = ({
  test,
  onClick,
}: {
  test: Record<string, any>;
  onClick: () => void;
}) => {
  return <div onClick={onClick}>Test Obj JSON {JSON.stringify(test)}</div>;
};
