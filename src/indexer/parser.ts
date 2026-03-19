import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import { ParsedElement, ChunkType, ImportRef } from '../types';
import { makeSymbolId, logger, normalizePath, getByteRange, hashContent } from '../utils';

/**
 * AST-based code parser using ts-morph.
 * Extracts functions, classes, components, services, and controllers.
 * Captures byte offsets for on-demand code retrieval.
 */
export class Parser {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 2, // React
      },
      skipAddingFilesFromTsConfig: true,
    });
  }

  /** Parse a single file and extract all code elements */
  parseFile(filePath: string): ParsedElement[] {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      logger.warn(`File not found: ${absPath}`);
      return [];
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const ext = path.extname(absPath);
    const normalizedPath = normalizePath(absPath);

    // Handle plain JS files with AngularJS patterns
    if (ext === '.js') {
      return this.parseJavaScript(normalizedPath, content);
    }

    try {
      const sourceFile = this.project.createSourceFile(
        `virtual_${Date.now()}${ext}`,
        content,
        { overwrite: true }
      );

      const elements: ParsedElement[] = [];
      const imports = this.extractImports(sourceFile);

      elements.push(...this.extractFunctions(sourceFile, normalizedPath, content, imports));
      elements.push(...this.extractClasses(sourceFile, normalizedPath, content, imports));
      elements.push(...this.extractExports(sourceFile, normalizedPath, content, elements, imports));
      this.detectReactComponents(elements, normalizedPath);

      // Disambiguate overloaded names
      this.disambiguateIds(elements);

      sourceFile.delete();
      return elements;
    } catch (err) {
      logger.error(`Failed to parse ${absPath}: ${err}`);
      return this.parseFallback(normalizedPath, content);
    }
  }

  /** Parse multiple files */
  parseFiles(filePaths: string[]): ParsedElement[] {
    const allElements: ParsedElement[] = [];
    for (const fp of filePaths) {
      const elements = this.parseFile(fp);
      allElements.push(...elements);
      logger.debug(`Parsed ${fp}: ${elements.length} elements`);
    }
    return allElements;
  }

  /** Extract import statements from a source file */
  private extractImports(sourceFile: SourceFile): ImportRef[] {
    const imports: ImportRef[] = [];

    for (const imp of sourceFile.getImportDeclarations()) {
      const source = imp.getModuleSpecifierValue();
      const defaultImport = imp.getDefaultImport();
      if (defaultImport) {
        imports.push({ name: defaultImport.getText(), source, isDefault: true });
      }
      for (const named of imp.getNamedImports()) {
        imports.push({ name: named.getName(), source, isDefault: false });
      }
    }

    return imports;
  }

  /** Extract function declarations and arrow functions */
  private extractFunctions(
    sourceFile: SourceFile, filePath: string, content: string, imports: ImportRef[]
  ): ParsedElement[] {
    const elements: ParsedElement[] = [];

    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName() || 'anonymous';
      const code = fn.getFullText().trim();
      const startLine = fn.getStartLineNumber();
      const endLine = fn.getEndLineNumber();
      const { byteOffset, byteLength } = getByteRange(content, startLine, endLine);

      elements.push({
        id: makeSymbolId(filePath, name, 'function'),
        type: 'function',
        name,
        filePath,
        code,
        startLine,
        endLine,
        byteOffset,
        byteLength,
        dependencies: this.extractDependencies(fn),
        imports,
      });
    }

    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const init = varDecl.getInitializer();
      if (init && Node.isArrowFunction(init)) {
        const name = varDecl.getName();
        const statement = varDecl.getVariableStatement();
        const node = statement || varDecl;
        const code = node.getFullText().trim();
        const startLine = node.getStartLineNumber();
        const endLine = node.getEndLineNumber();
        const { byteOffset, byteLength } = getByteRange(content, startLine, endLine);

        elements.push({
          id: makeSymbolId(filePath, name, 'function'),
          type: 'function',
          name,
          filePath,
          code,
          startLine,
          endLine,
          byteOffset,
          byteLength,
          dependencies: this.extractDependencies(init),
          imports,
        });
      }
    }

    return elements;
  }

  /** Extract class declarations with methods */
  private extractClasses(
    sourceFile: SourceFile, filePath: string, content: string, imports: ImportRef[]
  ): ParsedElement[] {
    const elements: ParsedElement[] = [];

    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName() || 'AnonymousClass';
      const code = cls.getFullText().trim();
      const startLine = cls.getStartLineNumber();
      const endLine = cls.getEndLineNumber();
      const { byteOffset, byteLength } = getByteRange(content, startLine, endLine);

      elements.push({
        id: makeSymbolId(filePath, name, 'class'),
        type: 'class',
        name,
        filePath,
        code,
        startLine,
        endLine,
        byteOffset,
        byteLength,
        dependencies: this.extractDependencies(cls),
        imports,
      });

      // Also extract individual methods
      for (const method of cls.getMethods()) {
        const methodName = method.getName();
        const qualifiedName = `${name}.${methodName}`;
        const methodCode = method.getFullText().trim();
        const mStartLine = method.getStartLineNumber();
        const mEndLine = method.getEndLineNumber();
        const mRange = getByteRange(content, mStartLine, mEndLine);

        elements.push({
          id: makeSymbolId(filePath, qualifiedName, 'method'),
          type: 'method',
          name: qualifiedName,
          filePath,
          code: methodCode,
          startLine: mStartLine,
          endLine: mEndLine,
          byteOffset: mRange.byteOffset,
          byteLength: mRange.byteLength,
          dependencies: this.extractDependencies(method),
          imports: [],
        });
      }
    }

    return elements;
  }

  /** Extract exported symbols not already captured */
  private extractExports(
    sourceFile: SourceFile,
    filePath: string,
    content: string,
    existing: ParsedElement[],
    imports: ImportRef[]
  ): ParsedElement[] {
    const elements: ParsedElement[] = [];
    const existingNames = new Set(existing.map(e => e.name));

    for (const exp of sourceFile.getExportedDeclarations()) {
      const [name, declarations] = exp;
      if (existingNames.has(name)) continue;

      for (const decl of declarations) {
        const code = decl.getFullText().trim();
        const startLine = decl.getStartLineNumber();
        const endLine = decl.getEndLineNumber();
        const { byteOffset, byteLength } = getByteRange(content, startLine, endLine);

        elements.push({
          id: makeSymbolId(filePath, name, 'export'),
          type: 'export',
          name,
          filePath,
          code,
          startLine,
          endLine,
          byteOffset,
          byteLength,
          dependencies: [],
          imports,
        });
      }
    }

    return elements;
  }

  /** Detect React functional components and upgrade their type */
  private detectReactComponents(elements: ParsedElement[], filePath: string): void {
    const ext = path.extname(filePath);
    if (!['.tsx', '.jsx'].includes(ext)) return;

    for (const el of elements) {
      if (el.type === 'function' && this.looksLikeReactComponent(el.name, el.code)) {
        el.type = 'component';
        el.id = makeSymbolId(filePath, el.name, 'component');
      }
    }
  }

  /** Heuristic: PascalCase name + returns JSX */
  private looksLikeReactComponent(name: string, code: string): boolean {
    const isPascalCase = /^[A-Z][a-zA-Z0-9]*$/.test(name);
    const hasJsx = /<[A-Za-z]/.test(code) || code.includes('React.createElement');
    return isPascalCase && hasJsx;
  }

  /** Disambiguate elements with the same ID (overloads) */
  private disambiguateIds(elements: ParsedElement[]): void {
    const idCounts = new Map<string, number>();
    for (const el of elements) {
      const count = idCounts.get(el.id) || 0;
      if (count > 0) {
        el.id = `${el.id}~${count}`;
      }
      idCounts.set(el.id, count + 1);
    }
  }

  /** Extract identifiers that look like dependencies */
  private extractDependencies(node: Node): string[] {
    const deps: string[] = [];
    try {
      const text = node.getFullText();
      const importMatches = text.matchAll(/(?:require\(['"]([^'"]+)['"]\)|from\s+['"]([^'"]+)['"])/g);
      for (const m of importMatches) {
        deps.push(m[1] || m[2]);
      }
      const callMatches = text.matchAll(/(?<!\w)([a-zA-Z_]\w*)\s*\(/g);
      for (const m of callMatches) {
        const name = m[1];
        if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'console'].includes(name)) {
          deps.push(name);
        }
      }
    } catch {
      // Silently handle extraction errors
    }
    return [...new Set(deps)];
  }

  /** Parse plain JavaScript files for AngularJS patterns */
  private parseJavaScript(filePath: string, content: string): ParsedElement[] {
    const elements: ParsedElement[] = [];
    const emptyImports: ImportRef[] = [];

    // AngularJS controller pattern
    const controllerRegex = /\.controller\s*\(\s*['"](\w+)['"]/g;
    let match;
    while ((match = controllerRegex.exec(content)) !== null) {
      const name = match[1];
      const chunk = this.extractBlock(content, match.index);
      const { byteOffset, byteLength } = getByteRange(content, chunk.startLine, chunk.endLine);

      elements.push({
        id: makeSymbolId(filePath, name, 'controller'),
        type: 'controller',
        name,
        filePath,
        code: chunk.code,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        byteOffset,
        byteLength,
        dependencies: this.extractAngularDeps(chunk.code),
        imports: emptyImports,
      });
    }

    // AngularJS service/factory pattern
    const serviceRegex = /\.(service|factory)\s*\(\s*['"](\w+)['"]/g;
    while ((match = serviceRegex.exec(content)) !== null) {
      const name = match[2];
      const chunk = this.extractBlock(content, match.index);
      const { byteOffset, byteLength } = getByteRange(content, chunk.startLine, chunk.endLine);

      elements.push({
        id: makeSymbolId(filePath, name, 'service'),
        type: 'service',
        name,
        filePath,
        code: chunk.code,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        byteOffset,
        byteLength,
        dependencies: this.extractAngularDeps(chunk.code),
        imports: emptyImports,
      });
    }

    // Regular function declarations
    const fnRegex = /function\s+(\w+)\s*\(/g;
    while ((match = fnRegex.exec(content)) !== null) {
      const name = match[1];
      const chunk = this.extractBlock(content, match.index);
      const alreadyExists = elements.some(e => e.name === name);
      if (!alreadyExists) {
        const { byteOffset, byteLength } = getByteRange(content, chunk.startLine, chunk.endLine);
        elements.push({
          id: makeSymbolId(filePath, name, 'function'),
          type: 'function',
          name,
          filePath,
          code: chunk.code,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          byteOffset,
          byteLength,
          dependencies: [],
          imports: emptyImports,
        });
      }
    }

    // If nothing found, treat as a single module chunk
    if (elements.length === 0) {
      const lineCount = content.split('\n').length;
      elements.push({
        id: makeSymbolId(filePath, path.basename(filePath, path.extname(filePath)), 'module'),
        type: 'module',
        name: path.basename(filePath, path.extname(filePath)),
        filePath,
        code: content,
        startLine: 1,
        endLine: lineCount,
        byteOffset: 0,
        byteLength: Buffer.byteLength(content, 'utf-8'),
        dependencies: [],
        imports: emptyImports,
      });
    }

    this.disambiguateIds(elements);
    return elements;
  }

  /** Extract AngularJS-specific dependencies ($scope, $http, etc.) */
  private extractAngularDeps(code: string): string[] {
    const deps: string[] = [];
    const depMatches = code.matchAll(/\$(\w+)/g);
    for (const m of depMatches) {
      deps.push(`$${m[1]}`);
    }
    return [...new Set(deps)];
  }

  /** Extract a code block starting from a position (brace-matching) */
  private extractBlock(content: string, startPos: number): { code: string; startLine: number; endLine: number } {
    let braceStart = content.indexOf('{', startPos);
    if (braceStart === -1) {
      braceStart = content.indexOf('(', startPos);
    }

    if (braceStart === -1) {
      const lineStart = content.substring(0, startPos).split('\n').length;
      return { code: content.substring(startPos, startPos + 200), startLine: lineStart, endLine: lineStart + 5 };
    }

    let depth = 0;
    let end = braceStart;
    for (let i = braceStart; i < content.length; i++) {
      if (content[i] === '{' || content[i] === '(') depth++;
      if (content[i] === '}' || content[i] === ')') depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }

    let stmtStart = startPos;
    while (stmtStart > 0 && content[stmtStart - 1] !== '\n' && content[stmtStart - 1] !== ';') {
      stmtStart--;
    }

    const code = content.substring(stmtStart, end);
    const startLine = content.substring(0, stmtStart).split('\n').length;
    const endLine = content.substring(0, end).split('\n').length;

    return { code, startLine, endLine };
  }

  /** Fallback: treat entire file as one chunk */
  private parseFallback(filePath: string, content: string): ParsedElement[] {
    const name = path.basename(filePath, path.extname(filePath));
    const lineCount = content.split('\n').length;
    return [{
      id: makeSymbolId(filePath, name, 'module'),
      type: 'module',
      name,
      filePath,
      code: content,
      startLine: 1,
      endLine: lineCount,
      byteOffset: 0,
      byteLength: Buffer.byteLength(content, 'utf-8'),
      dependencies: [],
      imports: [],
    }];
  }
}
