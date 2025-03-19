import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
// @ts-ignore
import TreeSitterC from 'tree-sitter-c';
import { coalesceConsecutiveComments } from './coalesce-comments'; // モジュールパスを調整

// Jestのセットアップ（必要に応じて）
// jest.config.js などで、tree-sitter-c のモック設定が必要になる場合があります。

describe('coalesceConsecutiveComments', () => {
  let parser: Parser;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(TreeSitterC);
  });

  const parseSourceCode = (sourceCode: string): Tree => {
    return parser.parse(sourceCode);
  };

  const findCompositeComments = (node: SyntaxNode, compositeComments: SyntaxNode[] = []): SyntaxNode[] => {
    if (node.type === 'composite_comment') {
      compositeComments.push(node);
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        findCompositeComments(child, compositeComments);
      }
    }
    return compositeComments;
  };


  it('should coalesce consecutive comments into a single composite comment', () => {
    const sourceCode = `
      // This is the first comment.
      // This is the second comment.
      int main() {
        return 0;
      }
    `;
    const tree = parseSourceCode(sourceCode);
    const newTree = coalesceConsecutiveComments(tree.rootNode);
    const compositeComments = findCompositeComments(newTree.rootNode);

    expect(compositeComments.length).toBe(1);
    expect(compositeComments[0].type).toBe('composite_comment');
    expect(compositeComments[0].text).toBe('// This is the first comment.\n// This is the second comment.');
  });


  it('should handle comments with code in between', () => {
    const sourceCode = `
      // This is the first comment.
      int x = 10;
      // This is the second comment.
    `;
    const tree = parseSourceCode(sourceCode);
    const newTree = coalesceConsecutiveComments(tree.rootNode);
    const compositeComments = findCompositeComments(newTree.rootNode);

    expect(compositeComments.length).toBe(0); // コメントが連続していないので、複合コメントは作成されない
  });

  it('should handle multiple sets of consecutive comments', () => {
    const sourceCode = `
      // This is the first comment block.
      // This is the second comment block.
      int x = 10;
      // This is the third comment block.
      // This is the fourth comment block.
    `;
    const tree = parseSourceCode(sourceCode);
    const newTree = coalesceConsecutiveComments(tree.rootNode);
    const compositeComments = findCompositeComments(newTree.rootNode);

    expect(compositeComments.length).toBe(0); // コメントが連続していないので、複合コメントは作成されない
  });

  it('should handle no comments', () => {
    const sourceCode = `
      int main() {
        return 0;
      }
    `;
    const tree = parseSourceCode(sourceCode);
    const newTree = coalesceConsecutiveComments(tree.rootNode);
    const compositeComments = findCompositeComments(newTree.rootNode);

    expect(compositeComments.length).toBe(0);
  });

  it('should handle a single comment', () => {
    const sourceCode = `
      // This is a single comment.
      int main() {
        return 0;
      }
    `;
    const tree = parseSourceCode(sourceCode);
    const newTree = coalesceConsecutiveComments(tree.rootNode);
    const compositeComments = findCompositeComments(newTree.rootNode);

    expect(compositeComments.length).toBe(0); // 連続していないのでcomposite commentにはならない。
  });

  it('should handle an empty source code', () => {
    const sourceCode = '';
    const tree = parseSourceCode(sourceCode);
    const newTree = coalesceConsecutiveComments(tree.rootNode);
    const compositeComments = findCompositeComments(newTree.rootNode);

    expect(compositeComments.length).toBe(0);
  });

  it('should handle a mix of block and line comments', () => {
    const sourceCode = `
      /* This is a block comment. */
      // This is a line comment.
      int main() {
        return 0;
      }
    `;
    const tree = parseSourceCode(sourceCode);
    const newTree = coalesceConsecutiveComments(tree.rootNode);
    const compositeComments = findCompositeComments(newTree.rootNode);
    expect(compositeComments.length).toBe(1);
    expect(compositeComments[0].text).toBe('/* This is a block comment. */\n// This is a line comment.');

  });

  it('should handle nested comments within a block comment', () => {
    const sourceCode = `
    /*
     * This is a block comment.
     * // This is a nested line comment.
     */
    int main() {
      return 0;
    }
    `;
    const tree = parseSourceCode(sourceCode);
    const newTree = coalesceConsecutiveComments(tree.rootNode);
    const compositeComments = findCompositeComments(newTree.rootNode);

    expect(compositeComments.length).toBe(1);
    expect(compositeComments[0].text).toBe('/*\n     * This is a block comment.\n     * // This is a nested line comment.\n     */');
  });

  it('should handle interleaved comments and whitespace', () => {
    const sourceCode = `
      // Comment 1
      \n
      // Comment 2
    `;
    const tree = parseSourceCode(sourceCode);
    const newTree = coalesceConsecutiveComments(tree.rootNode);
    const compositeComments = findCompositeComments(newTree.rootNode);

    expect(compositeComments.length).toBe(1);
    expect(compositeComments[0].text).toBe('// Comment 1\n\n// Comment 2');
  });


});