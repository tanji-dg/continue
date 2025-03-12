declare module 'wink-nlp-utils' {
  interface Token {
    tag: string;
    value: string;
  }

  interface StringModule {
    removeExtraSpaces(text: string): string;
    stem(text: string): string;
    tokenize(text: string, detailed?: boolean): Token[];
    ngram(text: string, n: number): string[];
  }

  interface TokensModule {
    removeWords(tokens: string[]): string[];
    setOfWords(tokens: string[]): string[]; // Set<string>から修正
  }

  const utils: {
    string: StringModule;
    tokens: TokensModule;
  };

    export = utils;
}
