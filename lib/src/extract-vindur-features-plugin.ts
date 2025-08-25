import type { PluginObj } from '@babel/core';
import { types as t } from '@babel/core';
import { murmur2 } from '@ls-stack/utils/hash';
import type { DebugLogger } from './babel-plugin';

export type ExtractedVindurFeatures = {
  cssVariables: Map<string, string>;
  keyframes: Map<string, string>;
  dynamicColors: Map<string, string>;
  themeColors: Map<string, Record<string, string>>;
  styledComponents: Map<
    string,
    {
      element: string;
      className: string;
      isExported: boolean;
    }
  >;
};

/**
 * Creates a plugin that extracts ALL Vindur features from external files
 * by tracking index consumption and extracting feature data, but WITHOUT transforming.
 * This ensures accurate index assignment while preserving existing mechanisms like vindurFn processing.
 */
export function createExtractVindurFeaturesPlugin(
  filePath: string,
  extractedFeatures: ExtractedVindurFeatures,
  debug?: DebugLogger,
): PluginObj {
  // Generate hash for this external file
  const fileHash = `v${murmur2(filePath)}`;
  let idIndex = 1;

  // Track processed variables to avoid double processing
  const processedVariables = new Set<string>();
  // Track processed template expressions to avoid double processing
  const processedTemplates = new WeakSet<t.TaggedTemplateExpression>();

  function logIndexConsumption(feature: string, index: number, extra?: string) {
    debug?.log(
      `[vindur:extract] ${feature} consumes index ${index} in ${filePath}${extra ? ` (${extra})` : ''}`,
    );
  }

  return {
    visitor: {
      // Track css and keyframes tagged templates
      TaggedTemplateExpression(path) {
        // Skip if already processed as part of variable assignment
        if (processedTemplates.has(path.node)) return;

        if (t.isIdentifier(path.node.tag)) {
          const tagName = path.node.tag.name;

          if (tagName === 'css') {
            // CSS template consumes index but we don't extract it here (it's context-dependent)
            logIndexConsumption('css template', idIndex);
            idIndex++;
          } else if (tagName === 'keyframes') {
            // Keyframes template consumes index and can be extracted
            const keyframeName = `${fileHash}-${idIndex}`;
            logIndexConsumption('keyframes template', idIndex, keyframeName);
            idIndex++;
            // Note: keyframes extraction would need more context to get the variable name
            // This is a simplified version
          }
        }
      },

      // Track styled components
      CallExpression(path) {
        if (
          t.isMemberExpression(path.node.callee)
          && t.isIdentifier(path.node.callee.object)
          && path.node.callee.object.name === 'styled'
        ) {
          const element =
            t.isIdentifier(path.node.callee.property) ?
              path.node.callee.property.name
            : 'unknown';
          const className = `${fileHash}-${idIndex}`;

          logIndexConsumption(
            'styled component',
            idIndex,
            `${element} -> ${className}`,
          );
          idIndex++;

          // Note: styled components would need more context to get the variable name and export status
          // This is a simplified version for index tracking
        }
      },

      // Track variable declarations for various Vindur features
      VariableDeclarator(path) {
        if (t.isIdentifier(path.node.id) && path.node.init) {
          const varName = path.node.id.name;

          if (t.isCallExpression(path.node.init)) {
            const callee = path.node.init.callee;

            // Handle createDynamicCssColor
            if (
              t.isIdentifier(callee)
              && callee.name === 'createDynamicCssColor'
              && path.node.init.arguments.length === 0
            ) {
              // Skip if already processed (e.g., in ExportNamedDeclaration)
              if (processedVariables.has(varName)) return;

              const hashId = `${fileHash}-${idIndex}`;
              extractedFeatures.dynamicColors.set(varName, hashId);
              processedVariables.add(varName);
              logIndexConsumption(
                'dynamic color variable',
                idIndex,
                `${varName} -> ${hashId}`,
              );
              idIndex++;
            }

            // Handle createStaticThemeColors (doesn't consume index)
            else if (
              t.isIdentifier(callee)
              && callee.name === 'createStaticThemeColors'
              && path.node.init.arguments.length === 1
              && t.isObjectExpression(path.node.init.arguments[0])
            ) {
              // Extract theme colors without consuming index
              const themeObj: Record<string, string> = {};
              const objExpr = path.node.init.arguments[0];

              for (const prop of objExpr.properties) {
                if (
                  t.isObjectProperty(prop)
                  && !prop.computed
                  && t.isIdentifier(prop.key)
                  && t.isStringLiteral(prop.value)
                ) {
                  themeObj[prop.key.name] = prop.value.value;
                }
              }

              extractedFeatures.themeColors.set(varName, themeObj);
              logIndexConsumption(
                'theme colors',
                0,
                `${varName} (no index consumed)`,
              );
            }

            // Handle styled component assignments
            else if (
              t.isMemberExpression(callee)
              && t.isIdentifier(callee.object)
              && callee.object.name === 'styled'
            ) {
              // Skip if already processed (e.g., in ExportNamedDeclaration)
              if (processedVariables.has(varName)) return;

              const element =
                t.isIdentifier(callee.property) ?
                  callee.property.name
                : 'unknown';
              const className = `${fileHash}-${idIndex}`;

              extractedFeatures.styledComponents.set(varName, {
                element,
                className,
                isExported: false, // Will be updated in ExportNamedDeclaration if needed
              });

              processedVariables.add(varName);
              logIndexConsumption(
                'styled component variable',
                idIndex,
                `${varName} (${element}) -> ${className}`,
              );
              idIndex++;
            }
          }

          // Handle tagged template expressions assigned to variables
          else if (t.isTaggedTemplateExpression(path.node.init)) {
            const tag = path.node.init.tag;
            const templateExpr = path.node.init;

            if (t.isIdentifier(tag)) {
              if (tag.name === 'css') {
                // Skip if already processed (e.g., in ExportNamedDeclaration)
                if (processedVariables.has(varName)) return;

                const className = `${fileHash}-${idIndex}`;
                extractedFeatures.cssVariables.set(varName, className);
                processedVariables.add(varName);
                processedTemplates.add(templateExpr); // Mark template as processed
                logIndexConsumption(
                  'css variable',
                  idIndex,
                  `${varName} -> ${className}`,
                );
                idIndex++;
              } else if (tag.name === 'keyframes') {
                // Skip if already processed (e.g., in ExportNamedDeclaration)
                if (processedVariables.has(varName)) return;

                const animationName = `${fileHash}-${idIndex}`;
                extractedFeatures.keyframes.set(varName, animationName);
                processedVariables.add(varName);
                processedTemplates.add(templateExpr); // Mark template as processed
                logIndexConsumption(
                  'keyframes variable',
                  idIndex,
                  `${varName} -> ${animationName}`,
                );
                idIndex++;
              }
            }
          }
        }
      },

      // Track exported features and mark them as exported
      ExportNamedDeclaration(path) {
        if (
          path.node.declaration
          && t.isVariableDeclaration(path.node.declaration)
        ) {
          for (const declarator of path.node.declaration.declarations) {
            if (
              t.isVariableDeclarator(declarator)
              && t.isIdentifier(declarator.id)
              && declarator.init
            ) {
              const varName = declarator.id.name;

              // Handle exported createDynamicCssColor
              if (
                t.isCallExpression(declarator.init)
                && t.isIdentifier(declarator.init.callee)
                && declarator.init.callee.name === 'createDynamicCssColor'
                && declarator.init.arguments.length === 0
              ) {
                const hashId = `${fileHash}-${idIndex}`;
                extractedFeatures.dynamicColors.set(varName, hashId);
                processedVariables.add(varName); // Mark as processed
                logIndexConsumption(
                  'exported dynamic color',
                  idIndex,
                  `${varName} -> ${hashId}`,
                );
                idIndex++;
              }

              // Handle exported CSS templates
              else if (
                t.isTaggedTemplateExpression(declarator.init)
                && t.isIdentifier(declarator.init.tag)
                && declarator.init.tag.name === 'css'
              ) {
                const className = `${fileHash}-${idIndex}`;
                extractedFeatures.cssVariables.set(varName, className);
                processedVariables.add(varName); // Mark as processed
                processedTemplates.add(declarator.init); // Mark template as processed
                logIndexConsumption(
                  'exported css',
                  idIndex,
                  `${varName} -> ${className}`,
                );
                idIndex++;
              }

              // Handle exported keyframes
              else if (
                t.isTaggedTemplateExpression(declarator.init)
                && t.isIdentifier(declarator.init.tag)
                && declarator.init.tag.name === 'keyframes'
              ) {
                const animationName = `${fileHash}-${idIndex}`;
                extractedFeatures.keyframes.set(varName, animationName);
                processedVariables.add(varName); // Mark as processed
                processedTemplates.add(declarator.init); // Mark template as processed
                logIndexConsumption(
                  'exported keyframes',
                  idIndex,
                  `${varName} -> ${animationName}`,
                );
                idIndex++;
              }

              // Handle exported styled components
              else if (t.isCallExpression(declarator.init)) {
                const callee = declarator.init.callee;
                if (
                  t.isMemberExpression(callee)
                  && t.isIdentifier(callee.object)
                  && callee.object.name === 'styled'
                ) {
                  const element =
                    t.isIdentifier(callee.property) ?
                      callee.property.name
                    : 'unknown';
                  const className = `${fileHash}-${idIndex}`;

                  extractedFeatures.styledComponents.set(varName, {
                    element,
                    className,
                    isExported: true,
                  });

                  processedVariables.add(varName); // Mark as processed
                  logIndexConsumption(
                    'exported styled component',
                    idIndex,
                    `${varName} (${element}) -> ${className}`,
                  );
                  idIndex++;
                }
              }

              // Mark existing styled components as exported
              else if (extractedFeatures.styledComponents.has(varName)) {
                const existing =
                  extractedFeatures.styledComponents.get(varName);
                if (existing) {
                  extractedFeatures.styledComponents.set(varName, {
                    ...existing,
                    isExported: true,
                  });
                  debug?.log(
                    `[vindur:extract] Marked ${varName} as exported in ${filePath}`,
                  );
                }
              }
            }
          }
        }
      },

      // NOTE: We intentionally do NOT process vindurFn functions here
      // Those are handled by the existing loadExternalFunction mechanism
      // to preserve error location information and avoid conflicts
    },
  };
}
