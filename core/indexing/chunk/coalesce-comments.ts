import Parser, { Point, SyntaxNode, Tree } from 'web-tree-sitter';
// @ts-ignore
import TreeSitterC from 'tree-sitter-c';

/**
 * 連続するコメントノードを一つの複合コメントノードにまとめる関数。
 * @param tree tree-sitterの構文木
 * @returns 変換後の構文木
 */
export function coalesceConsecutiveComments(tree: SyntaxNode): Tree {
  const rootNode = tree;

  const editTree = (node: SyntaxNode): SyntaxNode => {
    let newChildren: SyntaxNode[] = [];
    let consecutiveComments: SyntaxNode[] = [];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!; // childCountで確認しているので必ず存在する

      if (child.type === 'comment') {
        consecutiveComments.push(child);
      } else {
        if (consecutiveComments.length > 0) {
          // 連続するコメントがあった場合、新しい複合コメントノードを作成
          const firstComment = consecutiveComments[0];
          const lastComment = consecutiveComments[consecutiveComments.length - 1];

          const compositeCommentNode = createCompositeCommentNode(
            firstComment.startPosition,
            lastComment.endPosition,
            consecutiveComments
          );
          newChildren.push(compositeCommentNode);
          consecutiveComments = []; // 初期化
        }

        // 再帰的に子ノードを処理
        newChildren.push(editTree(child));
      }
    }

    // 末尾に連続するコメントが残っている場合の処理
    if (consecutiveComments.length > 0) {
      const firstComment = consecutiveComments[0];
      const lastComment = consecutiveComments[consecutiveComments.length - 1];

      const compositeCommentNode = createCompositeCommentNode(
        firstComment.startPosition,
        lastComment.endPosition,
        consecutiveComments
      );
      newChildren.push(compositeCommentNode);
    }

    // 新しい子ノードで親ノードを再構築
    return rebuildNode(node, newChildren);
  };


  const newRoot = editTree(rootNode);

  // 構文木を更新 (editメソッドを使うことは今回のケースでは適切ではない)
  // 構文木全体を再構築しているため、Incremental parsingの恩恵は受けられない
  const parser = new Parser();
  parser.setLanguage(TreeSitterC);
  const newTree = parser.parse(tree.text, newRoot);

  return newTree;
}

/**
 * 複合コメントノードを作成するヘルパー関数。
 * @param startPosition 開始位置
 * @param endPosition 終了位置
 * @param comments コメントノードの配列
 * @returns 複合コメントノード
 */
function createCompositeCommentNode(startPosition: Point, endPosition: Point, comments: SyntaxNode[]): SyntaxNode {
  const text = comments.map(c => c.text).join('\n'); // 必要に応じて改行を追加
  return {
    type: 'composite_comment',
    isNamed: true, // 命名されたノードとして扱う
    startPosition: startPosition,
    endPosition: endPosition,
    startIndex: comments[0].startIndex,
    endIndex: comments[comments.length - 1].endIndex,
    parent: null, // 親ノードは後で設定
    children: comments, // 子ノードとして元のコメントを保持
    childCount: comments.length,
    text: text,
    toString: () => `(composite_comment)`,  // デバッグ用
    // 以下のメソッドは、実際には tree-sitter の SyntaxNode に存在しないので、最小限の実装
    child: (index: number) => comments[index],
    firstChild: comments[0],
    lastChild: comments[comments.length - 1],
    nextSibling: null,
    previousSibling: null,
    nextNamedSibling: null,
    previousNamedSibling: null,
    firstNamedChild: comments[0],
    lastNamedChild: comments[comments.length - 1],
    namedChildCount: comments.length,
    namedChildren: comments,
    hasError: false,
    isMissing: false,
    id: 0, // ダミーの値
    tree: comments[0].tree,  // ダミーの値 (ただし、nullは避ける)
    grammarType: null,
  } as any;
}


/**
 * 新しい子ノードを持つ親ノードを再構築するヘルパー関数。
 * @param node 親ノード
 * @param newChildren 新しい子ノードの配列
 * @returns 再構築された親ノード
 */
function rebuildNode(node: SyntaxNode, newChildren: SyntaxNode[]): SyntaxNode {

    //  startPositionとendPositionを更新
    const startPosition = newChildren.length > 0 ? newChildren[0].startPosition : node.startPosition;
    const endPosition = newChildren.length > 0 ? newChildren[newChildren.length - 1].endPosition : node.endPosition;

    return {
      type: node.type,
      isNamed: node.isNamed,
      startPosition: startPosition,
      endPosition: endPosition,
      startIndex: newChildren.length > 0 ? newChildren[0].startIndex : node.startIndex,
      endIndex: newChildren.length > 0 ? newChildren[newChildren.length - 1].endIndex : node.endIndex,
      parent: node.parent, // 親ノードは引き継ぐ
      children: newChildren,
      childCount: newChildren.length,
      text: node.text,
      toString: () => `(${node.type})`,  // デバッグ用
      // 以下のメソッドは、実際には tree-sitter の SyntaxNode に存在しないので、最小限の実装
      child: (index: number) => newChildren[index],
      firstChild: newChildren[0],
      lastChild: newChildren[newChildren.length - 1],
      nextSibling: node.nextSibling,
      previousSibling: node.previousSibling,
      nextNamedSibling: node.nextNamedSibling,
      previousNamedSibling: node.previousNamedSibling,
      firstNamedChild: newChildren[0],
      lastNamedChild: newChildren[newChildren.length - 1],
      namedChildCount: newChildren.length,
      namedChildren: newChildren,
      hasError: node.hasError,
      isMissing: node.isMissing,
      //id: node.id,
      tree: node.tree,
      grammarType: node.grammarType
    } as any;
}

/**
 *  指定されたコード文字列を解析して構文木を生成する
 * @param sourceCode C言語のソースコード
 * @returns 生成された構文木
 */
function parseSourceCode(sourceCode: string): Tree {
  const parser = new Parser();
  parser.setLanguage(TreeSitterC);
  const tree = parser.parse(sourceCode);
  return tree;
}


// 使用例
const sourceCode = `
// This is the first comment.
// This is the second comment.
int main() {
  // Inside main.
  return 0;
}
`;

const tree = parseSourceCode(sourceCode);
const newTree = coalesceConsecutiveComments(tree.rootNode);

// 新しい構文木から複合コメントノードを探す
function findCompositeComments(node: SyntaxNode, compositeComments: SyntaxNode[] = []): SyntaxNode[] {
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
}


const compositeComments = findCompositeComments(newTree.rootNode);

console.log("Composite Comments Found:", compositeComments.length); // 複合コメントノードが見つかった数を出力
compositeComments.forEach((comment, index) => {
    console.log(`Composite Comment ${index + 1}:`);
    console.log(`  Type: ${comment.type}`);
    console.log(`  Text: ${comment.text}`);
    console.log(`  Start: ${comment.startPosition}`);
    console.log(`  End: ${comment.endPosition}`);
    console.log(`  Children Count: ${comment.childCount}`);
});

//console.log(newTree.rootNode.toString()); // 新しい構文木の全体構造を出力（デバッグ用）