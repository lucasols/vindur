import { SourceMapGenerator } from 'source-map';
import type { RawSourceMap } from 'source-map';
import { types as t } from '@babel/core';

/**
 * Source location information for CSS rules
 */
export type CssRuleLocation = {
  /** The original source file path */
  source: string;
  /** Original source content */
  sourceContent: string;
  /** Start position in original source */
  start: { line: number; column: number };
  /** End position in original source */
  end: { line: number; column: number };
};

/**
 * CSS rule with associated source location
 */
export type CssRuleWithLocation = {
  /** The generated CSS content */
  css: string;
  /** Source location information, undefined for generated CSS (like global styles without location) */
  location?: CssRuleLocation;
};

/**
 * CSS source map generator that tracks mappings between generated CSS and original source locations
 */
export class CssSourceMapGenerator {
  private generator: SourceMapGenerator;
  private generatedLine: number = 0;
  private generatedColumn: number = 0;
  private addedSources = new Set<string>();

  constructor(outputFile: string = 'styles.css') {
    this.generator = new SourceMapGenerator({ 
      file: outputFile,
      skipValidation: true // Skip validation for better performance
    });
  }

  /**
   * Add a CSS rule with its source location and generate mappings
   */
  addCssRule(cssRule: CssRuleWithLocation): void {
    if (cssRule.location) {
      // Add source content if not already added
      if (!this.addedSources.has(cssRule.location.source)) {
        this.generator.setSourceContent(cssRule.location.source, cssRule.location.sourceContent);
        this.addedSources.add(cssRule.location.source);
      }

      // Add mapping at the start of the CSS rule
      this.generator.addMapping({
        generated: { line: this.generatedLine + 1, column: this.generatedColumn }, // Source maps are 1-based for lines
        source: cssRule.location.source,
        original: { line: cssRule.location.start.line + 1, column: cssRule.location.start.column },
      });
    }

    // Track generated position as we write the CSS
    this.writeToGenerated(cssRule.css);

    // Add double newline separator between rules (matching current behavior)
    if (cssRule.css.trim() !== '') {
      this.writeToGenerated('\n\n');
    }
  }

  /**
   * Track writing content to generated output and update position counters
   */
  private writeToGenerated(content: string): void {
    for (const char of content) {
      if (char === '\n') {
        this.generatedLine++;
        this.generatedColumn = 0;
      } else {
        this.generatedColumn++;
      }
    }
  }

  /**
   * Generate the final source map
   */
  toJSON(): RawSourceMap {
    return this.generator.toJSON();
  }

  /**
   * Get the current generated position (for debugging)
   */
  getCurrentPosition(): { line: number; column: number } {
    return { line: this.generatedLine, column: this.generatedColumn };
  }
}

/**
 * Create a CssRuleLocation from a Babel AST TemplateLiteral node
 */
export function createLocationFromTemplateLiteral(
  quasi: t.TemplateLiteral,
  sourceFilePath: string,
  sourceContent: string,
): CssRuleLocation | undefined {
  if (!quasi.loc) return undefined;

  return {
    source: sourceFilePath,
    sourceContent,
    start: { line: quasi.loc.start.line - 1, column: quasi.loc.start.column }, // Convert to 0-based
    end: { line: quasi.loc.end.line - 1, column: quasi.loc.end.column }, // Convert to 0-based
  };
}

/**
 * Create a CssRuleLocation from specific start/end positions
 */
export function createLocationFromPositions(
  sourceFilePath: string,
  sourceContent: string,
  start: { line: number; column: number },
  end: { line: number; column: number },
): CssRuleLocation {
  return {
    source: sourceFilePath,
    sourceContent,
    start,
    end,
  };
}