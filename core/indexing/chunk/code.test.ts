import { SyntaxNode } from "web-tree-sitter";
import { ChunkWithoutID } from "../..";
import { getParserForFile } from "../../util/treeSitter";

import { countTokens } from "../../llm/countTokens";
import { codeChunker } from "./code";

async function genToArr<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of generator) {
    result.push(item);
  }
  return result;
}

async function genToStrs(
  generator: AsyncGenerator<ChunkWithoutID>,
): Promise<string[]> {
  return (await genToArr(generator)).map((chunk) => chunk.content);
}

describe("codeChunker", () => {
  test("should return empty array if file empty", async () => {
    const chunks = await genToStrs(codeChunker("test.ts", "", 100));
    expect(chunks).toEqual([]);
  });

  test("should include entire file if smaller than max chunk size", async () => {
    const chunks = await genToStrs(codeChunker("test.ts", "abc", 100));
    expect(chunks).toEqual(["abc"]);
  });

  test("should capture small class and function from large python file", async () => {
    const extraLine = "# This is a comment";
    const myClass = "class MyClass:\n    def __init__(self):\n        pass";
    const myFunction = "def my_function():\n    return \"Hello, World!\"";

    const file =
      Array(100).fill(extraLine).join("\n") +
      "\n\n" +
      myClass +
      "\n\n" +
      myFunction +
      "\n\n" +
      Array(100).fill(extraLine).join("\n");

    const chunks = await genToStrs(codeChunker("test.py", file, 200));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks).toContain(myClass);
    expect(chunks).toContain(myFunction);
  });

  test("should split large python class into methods and class with truncated methods", async () => {
    const methodI = (i: number) =>
      `    def method${i}():\n        return "Hello, ${i}!"`;

    const file =
      "class MyClass:\n" +
      Array(100)
        .fill(0)
        .map((_, i) => methodI(i + 1))
        .join("\n") +
      "\n\n";

    //console.log(file);

    const chunks = await genToStrs(codeChunker("test.py", file, 200));
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks[0].startsWith("class MyClass:\n    def method1():\n        ..."),
    ).toBe(true);
    // The extra spaces seem to be a bug with tree-sitter-python
    expect(chunks).toContain("def method1():\n        return \"Hello, 1!\"");
    expect(chunks).toContain("def method20():\n        return \"Hello, 20!\"");
  });

  test("codeChunkerの使用法の確認", async () => {
    const file = "print('Hello, World!')";
    const chunks = await genToStrs(codeChunker("test.py", file, 10));
    expect(chunks).toEqual(["print('Hello, World!')"]);
  });

  test("C言語ヘッダーの動作確認。コメントもchunkに含む", async () => {
    const extraLine = "// This is a comment";
    const myClass = "void init();\n";
    const myFunction = "void init() {\n    return;\n}";

    const file =
      Array(100).fill(extraLine).join("\n") +
      "\n\n" +
      myClass +
      "\n\n" +
      myFunction +
      "\n\n" +
      Array(100).fill(extraLine).join("\n");
    //console.log(file);

    expect(countTokens(extraLine)).toEqual(6);

    const chunks = await genToStrs(codeChunker("test.h", file, 200));
    expect(chunks.length).toBeGreaterThan(1);
    //console.log(chunks);
    //expect(chunks.length).toEqual(3);
    //expect(chunks).toContain(myClass);
    expect(chunks).toContain(myFunction);
    expect(chunks).toContain(extraLine);
  });

  test("日本語コメントを含むヘッダーの動作確認", async () => {
    const extraLine = "// 日本語のCommentのテスト";

    const file =
      Array(3).fill(extraLine).join("\n");

    expect(countTokens(extraLine)).toEqual(12);
    expect(countTokens(file)).toEqual(12 * 3);

    const genChunks = await genToArr(codeChunker("test.h", file, 200));
    expect(genChunks.length).toEqual(1);
    expect(genChunks[0].startLine).toEqual(0);
    expect(genChunks[0].endLine).toEqual(2);

    let chunks = await genToStrs(codeChunker("test.h", file, 200));
    expect(chunks.length).toEqual(1);

    chunks = await genToStrs(codeChunker("test.h", file, 12 * 3 + 1));
    expect(chunks.length).toEqual(1);

    chunks = await genToStrs(codeChunker("test.h", file, 12 * 3));
    expect(chunks.length).toEqual(2);
  });


  test("print tree of test.c file", async () => {
    const extraLine = "// This is a comment";
    const myDefine = "#define PI 3.14 // Define a constant value for PI\n";
    const myInclude = "#include <stdio.h>\n";
    const myClass = "void init();\n";
    const myFunction = "void init() {\n    return;\n}";

    const file =
      Array(2).fill(extraLine).join("\n") +
      "\n\n" +
      myDefine +
      "\n\n" +
      myInclude +
      "\n\n" +
      myClass +
      "\n\n" +
      myFunction +
      "\n\n" +
      Array(2).fill(extraLine).join("\n");

    const parser = await getParserForFile("test.c");
    if (!parser) throw new Error("Parser not found");
    const tree = parser.parse(file);

    function printTree(node: SyntaxNode, indent = '') {
      process.stdout.write(`${indent}${node.type}: `);
      process.stdout.write(`${indent}${node.text}\n`);
      if (node.namedChildren) {
        node.namedChildren.forEach(child => printTree(child, `${indent}  `));
      }
    }

    // タイトルを表示
    console.log('Parsing Tree:');
    //printTree(tree.rootNode);
  
    let chunks = await genToStrs(codeChunker("test.h", file, 20));
    expect(chunks.length).toBeGreaterThan(1);
    //expect(chunks.length).toEqual(4);
    //expect(chunks).toContain(myClass);
    expect(chunks[0]).toContain(extraLine);
    expect(chunks[1]).toContain(myFunction);
    expect(chunks[2]).toContain(extraLine);
    expect(chunks[3]).toContain(extraLine);
  });
});
