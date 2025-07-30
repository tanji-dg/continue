//import * as Encoding from "encoding-japanese";
import { detect } from "encoding-japanese";

class SupportSJIS {
    public static MAX_BYTES = 100000;

    // エンコーディング検出のために使用するサンプルサイズ
    private static DETECTION_SAMPLE_SIZE = 4096; // 4KB

    // デフォルトのフォールバックエンコーディング
    private static fallbackEncoding: string = "utf-8";

    /**
     * バッファからエンコーディングを検出する
     */
    public static  detectEncoding(buffer: Buffer): string {
        // BOMがある場合はそれを優先
        if (
            buffer.length >= 3 &&
            buffer[0] === 0xef &&
            buffer[1] === 0xbb &&
            buffer[2] === 0xbf
        ) {
            return "utf-8"; // UTF-8 with BOM
        }
        if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
            return "utf-16le"; // UTF-16 LE
        }
        if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
            return "utf-16be"; // UTF-16 BE
        }

        // BOMがなければjschardetで検出
        // パフォーマンスのため、先頭の一部だけを使用
        const sample = new Uint8Array(
            buffer.slice(
                0,
                Math.min(buffer.length, SupportSJIS.DETECTION_SAMPLE_SIZE)
            )
        );
        const detected = detect(sample);

        // 検出結果をiconv-liteが理解できる形式に変換
        const detectedEncoding = SupportSJIS.normalizeEncodingName(detected as string);

        // 検出の信頼度が低い場合はフォールバック
        if (!detectedEncoding) {
            return SupportSJIS.fallbackEncoding;
        }

        return detectedEncoding;
    }

    /**
     * エンコーディング名を正規化
     */
    private static normalizeEncodingName(encoding: string | null | undefined): string {
        if (!encoding) return SupportSJIS.fallbackEncoding;

        // 小文字に変換して余分な文字を削除
        const normalized = encoding.toLowerCase().replace(/[^a-z0-9]/g, "");

        // エンコーディング名の変換マップ
        const encodingMap: Record<string, string> = {
            shiftjis: "shift_jis",
            sjis: "shift_jis",
            ms932: "shift_jis",
            xsjis: "shift_jis",
            windows31j: "shift_jis",
            cp932: "shift_jis",
            eucjp: "euc-jp",
            xeucjp: "euc-jp",
            iso2022jp: "iso-2022-jp",
            utf8: "utf-8",
            utf16le: "utf-16le",
            utf16be: "utf-16be",
            ascii: "ascii",
        };

        return encodingMap[normalized] || encoding;
    }
}

export { SupportSJIS };

