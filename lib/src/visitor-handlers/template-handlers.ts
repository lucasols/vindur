import { TransformError } from '../custom-errors';
import type { NodePath } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { types as t } from '@babel/core';
import {
  processStyledTemplate,
  processKeyframes,
  processGlobalStyle,
} from '../css-processing';
import type { CssProcessingContext } from '../css-processing';
import { createLocationFromTemplateLiteral } from '../css-source-map';

type TaggedTemplateHandlerContext = {
  context: CssProcessingContext;
  dev: boolean;
  fileHash: string;
  classIndex: { current: number };
  sourceFilePath: string;
  sourceContent: string;
};

export function handleCssTaggedTemplate(
  path: NodePath<t.TaggedTemplateExpression>,
  handlerContext: TaggedTemplateHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex, sourceFilePath, sourceContent } = handlerContext;

  if (
    !context.state.vindurImports.has('css')
    || !t.isIdentifier(path.node.tag)
    || path.node.tag.name !== 'css'
  ) {
    return false;
  }

  const location = createLocationFromTemplateLiteral(
    path.node.quasi,
    sourceFilePath,
    sourceContent,
  );
  
  const result = processStyledTemplate(
    path.node.quasi,
    context,
    undefined,
    'css',
    dev,
    fileHash,
    classIndex.current,
    classIndex,
    location,
  );
  classIndex.current++;

  // Inject warnings for scoped variables in dev mode
  if (dev && result.warnings && result.warnings.length > 0) {
    const statement = path.getStatementParent();
    if (statement) {
      for (const warning of result.warnings) {
        const warnStatement = t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.identifier('console'), t.identifier('warn')),
            [t.stringLiteral(warning)],
          ),
        );
        statement.insertAfter(warnStatement);
      }
    }
  }

  // Replace the tagged template with the class name string
  path.replaceWith(t.stringLiteral(result.finalClassName));

  return true;
}

export function handleKeyframesTaggedTemplate(
  path: NodePath<t.TaggedTemplateExpression>,
  handlerContext: TaggedTemplateHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex, sourceFilePath, sourceContent } = handlerContext;

  if (
    !context.state.vindurImports.has('keyframes')
    || !t.isIdentifier(path.node.tag)
    || path.node.tag.name !== 'keyframes'
  ) {
    return false;
  }

  const location = createLocationFromTemplateLiteral(
    path.node.quasi,
    sourceFilePath,
    sourceContent,
  );

  const result = processKeyframes(
    path.node.quasi,
    context,
    undefined,
    dev,
    fileHash,
    classIndex.current,
    location,
  );
  classIndex.current++;

  // Replace the tagged template with the animation name string
  path.replaceWith(t.stringLiteral(result.finalClassName));

  return true;
}

export function handleGlobalStyleTaggedTemplate(
  path: NodePath<t.TaggedTemplateExpression>,
  handlerContext: TaggedTemplateHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex, sourceFilePath, sourceContent } = handlerContext;

  if (
    !context.state.vindurImports.has('createGlobalStyle')
    || !t.isIdentifier(path.node.tag)
    || path.node.tag.name !== 'createGlobalStyle'
  ) {
    return false;
  }

  const location = createLocationFromTemplateLiteral(
    path.node.quasi,
    sourceFilePath,
    sourceContent,
  );

  const result = processGlobalStyle(
    path.node.quasi,
    context,
    fileHash,
    classIndex,
    location,
  );

  // Inject warnings for scoped variables in dev mode
  if (dev && result.warnings && result.warnings.length > 0) {
    const statement = path.getStatementParent();
    if (statement) {
      for (const warning of result.warnings) {
        const warnStatement = t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.identifier('console'), t.identifier('warn')),
            [t.stringLiteral(warning)],
          ),
        );
        statement.insertAfter(warnStatement);
      }
    }
  }

  // Remove createGlobalStyle expression since it produces no output
  if (t.isExpressionStatement(path.parent)) {
    // Remove the entire expression statement
    path.parentPath.remove();
  } else {
    // If it's part of another expression, replace with void 0
    path.replaceWith(t.unaryExpression('void', t.numericLiteral(0)));
  }

  return true;
}

export function handleInlineStyledError(
  path: NodePath<t.TaggedTemplateExpression>,
  handlerContext: TaggedTemplateHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex } = handlerContext;

  if (
    !context.state.vindurImports.has('styled')
    || !t.isMemberExpression(path.node.tag)
    || !t.isIdentifier(path.node.tag.object)
    || path.node.tag.object.name !== 'styled'
    || !t.isIdentifier(path.node.tag.property)
  ) {
    return false;
  }

  // Check if this is a direct default export
  const parent = path.parent;
  if (t.isExportDefaultDeclaration(parent)) {
    // Handle export default styled.div`...`
    const tagName = path.node.tag.property.name;

    const result = processStyledTemplate(
      path.node.quasi,
      context,
      '', // Use empty string for default export instead of undefined
      `styled.${tagName}`,
      dev,
      fileHash,
      classIndex.current,
      classIndex,
    );
    classIndex.current++;

    // Transform to styledComponent function call
    context.state.vindurImports.add('styledComponent');
    path.replaceWith(
      t.callExpression(t.identifier('styledComponent'), [
        t.stringLiteral(tagName),
        t.stringLiteral(result.finalClassName),
      ]),
    );
    return true;
  }

  // For other inline styled usage, we keep it as an error
  throw new TransformError(
    'Inline styled component usage is not supported. Please assign styled components to a variable first.',
    notNullish(path.node.loc),
  );
}
