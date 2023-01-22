import PDFDict from 'src/core/objects/PDFDict';
import PDFStream from 'src/core/objects/PDFStream';
import PDFContext from 'src/core/PDFContext';
import { arrayAsString } from 'src/utils';
import { CipherTransform } from '../crypto';

class PDFRawStream extends PDFStream {
  static of = (dict: PDFDict, contents: Uint8Array, transform?: CipherTransform) =>
    new PDFRawStream(dict, contents, transform);

  readonly contents: Uint8Array;
  readonly transform?: CipherTransform;

  private constructor(dict: PDFDict, contents: Uint8Array, transform?: CipherTransform) {
    super(dict);
    this.contents = contents;
    this.transform = transform;
  }

  asUint8Array(): Uint8Array {
    return this.contents.slice();
  }

  clone(context?: PDFContext): PDFRawStream {
    return PDFRawStream.of(this.dict.clone(context), this.contents.slice());
  }

  getContentsString(): string {
    return arrayAsString(this.contents);
  }

  getContents(): Uint8Array {
    return this.contents;
  }

  getContentsSize(): number {
    return this.contents.length;
  }
}

export default PDFRawStream;
