import { PDFObjectParsingError, PDFStreamParsingError, Position } from 'src/core/errors';
import PDFArray from 'src/core/objects/PDFArray';
import PDFBool from 'src/core/objects/PDFBool';
import PDFDict, { DictMap } from 'src/core/objects/PDFDict';
import PDFHexString from 'src/core/objects/PDFHexString';
import PDFName from 'src/core/objects/PDFName';
import PDFNull from 'src/core/objects/PDFNull';
import PDFNumber from 'src/core/objects/PDFNumber';
import PDFObject from 'src/core/objects/PDFObject';
import PDFRawStream from 'src/core/objects/PDFRawStream';
import PDFRef from 'src/core/objects/PDFRef';
import PDFStream from 'src/core/objects/PDFStream';
import PDFString from 'src/core/objects/PDFString';
import BaseParser from 'src/core/parser/BaseParser';
import ByteStream from 'src/core/parser/ByteStream';
import PDFContext from 'src/core/PDFContext';
import PDFCatalog from 'src/core/structures/PDFCatalog';
import PDFPageLeaf from 'src/core/structures/PDFPageLeaf';
import PDFPageTree from 'src/core/structures/PDFPageTree';
import CharCodes from 'src/core/syntax/CharCodes';
import { IsDelimiter } from 'src/core/syntax/Delimiters';
import { Keywords } from 'src/core/syntax/Keywords';
import { IsDigit, IsNumeric } from 'src/core/syntax/Numeric';
import { IsWhitespace } from 'src/core/syntax/Whitespace';
import { arrayAsString, charFromCode } from 'src/utils';
import { CipherTransformFactory } from '../crypto';

// TODO: Throw error if eof is reached before finishing object parse...
class PDFObjectParser extends BaseParser {
  static forBytes = (
    bytes: Uint8Array,
    context: PDFContext,
    capNumbers?: boolean,
  ) => new PDFObjectParser(ByteStream.of(bytes), context, capNumbers);

  static forByteStream = (
    byteStream: ByteStream,
    context: PDFContext,
    capNumbers = false,
  ) => new PDFObjectParser(byteStream, context, capNumbers);

  protected readonly context: PDFContext;
  private readonly cryptoFactory?: CipherTransformFactory;

  constructor(
    byteStream: ByteStream,
    context: PDFContext,
    capNumbers = false,
    cryptoFactory?: CipherTransformFactory,
  ) {
    super(byteStream, capNumbers);
    this.context = context;
    this.cryptoFactory = cryptoFactory;
  }

  // TODO: Is it possible to reduce duplicate parsing for ref lookaheads?
  parseObject(ref?: PDFRef): PDFObject {
    this.skipWhitespaceAndComments();

    if (this.matchKeyword(Keywords.true)) return PDFBool.True;
    if (this.matchKeyword(Keywords.false)) return PDFBool.False;
    if (this.matchKeyword(Keywords.null)) return PDFNull;

    const byte = this.bytes.peek();

    if (
      byte === CharCodes.LessThan &&
      this.bytes.peekAhead(1) === CharCodes.LessThan
    ) {
      return this.parseDictOrStream(ref);
    }
    if (byte === CharCodes.LessThan) return this.parseHexString(ref);
    if (byte === CharCodes.LeftParen) return this.parseString(ref);
    if (byte === CharCodes.ForwardSlash) return this.parseName();
    if (byte === CharCodes.LeftSquareBracket) return this.parseArray(ref);
    if (IsNumeric[byte]) return this.parseNumberOrRef();

    throw new PDFObjectParsingError(this.bytes.position(), byte);
  }

  protected parseNumberOrRef(): PDFNumber | PDFRef {
    const firstNum = this.parseRawNumber();
    this.skipWhitespaceAndComments();

    const lookaheadStart = this.bytes.offset();
    if (IsDigit[this.bytes.peek()]) {
      const secondNum = this.parseRawNumber();
      this.skipWhitespaceAndComments();
      if (this.bytes.peek() === CharCodes.R) {
        this.bytes.assertNext(CharCodes.R);
        return PDFRef.of(firstNum, secondNum);
      }
    }

    this.bytes.moveTo(lookaheadStart);
    return PDFNumber.of(firstNum);
  }

  // TODO: Maybe update PDFHexString.of() logic to remove whitespace and validate input?
  protected parseHexString(ref?: PDFRef): PDFHexString {
    let value = '';

    this.bytes.assertNext(CharCodes.LessThan);
    while (!this.bytes.done() && this.bytes.peek() !== CharCodes.GreaterThan) {
      value += charFromCode(this.bytes.next());
    }
    this.bytes.assertNext(CharCodes.GreaterThan);

    if (this.cryptoFactory && ref) {
      const transformer = this.cryptoFactory.createCipherTransform(
        ref.objectNumber,
        ref.generationNumber,
      );
      const arr = transformer.decryptBytes(PDFHexString.of(value).asBytes());
      value = arr.reduce(
        (str: string, byte: number) => str + byte.toString(16).padStart(2, '0'),
        '',
      );
    }

    return PDFHexString.of(value);
  }

  protected parseString(ref?: PDFRef): PDFString {
    let numParen = 1;
    let done = false;
    const strBuf: number[] = [];

    this.bytes.assertNext(CharCodes.LeftParen); // Consume left parenthesis

    let ch = this.bytes.next();
    while (!this.bytes.done()) {
      let charBuffered = false;
      switch (ch | 0) {
        case -1:
          console.warn('Unterminated string');
          done = true;
          break;
        case CharCodes.LeftParen: // '('
          ++numParen;
          strBuf.push(0x28);
          break;
        case CharCodes.RightParen: // ')'
          if (--numParen === 0) {
            done = true;
          } else {
            strBuf.push(0x29);
          }
          break;
        case 0x5c: // '\\'
          ch = this.bytes.next();
          switch (ch) {
            case -1:
              console.warn('Unterminated string');
              done = true;
              break;
            case 0x6e: // 'n'
              strBuf.push(10);  // '\n'
              break;
            case 0x72: // 'r'
              strBuf.push(13);  // '\r'
              break;
            case 0x74: // 't'
              strBuf.push(9);    // '\t'
              break;
            case 0x62: // 'b'
              strBuf.push(8);    // '\b'
              break;
            case 0x66: // 'f'
              strBuf.push(12);    // '\f'
              break;
            case 0x5c: // '\'
            case 0x28: // '('
            case 0x29: // ')'
              strBuf.push(ch);
              break;
            case 0x30: // '0'
            case 0x31: // '1'
            case 0x32: // '2'
            case 0x33: // '3'
            case 0x34: // '4'
            case 0x35: // '5'
            case 0x36: // '6'
            case 0x37: // '7'
              let x = ch & 0x0f;
              ch = this.bytes.next();
              charBuffered = true;
              if (ch >= /* '0' = */ 0x30 && ch <= /* '7' = */ 0x37) {
                x = (x << 3) + (ch & 0x0f);
                ch = this.bytes.next();
                if (ch >= /* '0' = */ 0x30 && ch /* '7' = */ <= 0x37) {
                  charBuffered = false;
                  x = (x << 3) + (ch & 0x0f);
                }
              }
              strBuf.push(x);
              break;
            case 0x0d: // CR
              if (this.bytes.peek() === /* LF = */ 0x0a) {
                this.bytes.next();
              }
              break;
            case 0x0a: // LF
              break;
            default:
              strBuf.push(ch);
              break;
          }
          break;
        default:
          strBuf.push(ch);
          break;
      }

      if (done) {
        break;
      }
      if (!charBuffered) {
        ch = this.bytes.next();
      }
    }

    let actualValue: string;
    if (this.cryptoFactory && ref) {
      const transformer = this.cryptoFactory.createCipherTransform(
        ref.objectNumber,
        ref.generationNumber,
      );
      const bytes = new Uint8Array(strBuf.length);
      for (let i = strBuf.length - 1; i >= 0; i--) {
        bytes[i] = strBuf[i];
      }
      actualValue = arrayAsString(transformer.decryptBytes(bytes));
    } else {
      actualValue = '';
      for (ch of strBuf) {
        actualValue += charFromCode(ch);
      }
    }
    return PDFString.of(actualValue);
  }

  // TODO: Compare performance of string concatenation to charFromCode(...bytes)
  // TODO: Maybe preallocate small Uint8Array if can use charFromCode?
  protected parseName(): PDFName {
    this.bytes.assertNext(CharCodes.ForwardSlash);

    let name = '';
    while (!this.bytes.done()) {
      const byte = this.bytes.peek();
      if (IsWhitespace[byte] || IsDelimiter[byte]) break;
      name += charFromCode(byte);
      this.bytes.next();
    }

    return PDFName.of(name);
  }

  protected parseArray(ref?: PDFRef): PDFArray {
    this.bytes.assertNext(CharCodes.LeftSquareBracket);
    this.skipWhitespaceAndComments();

    const pdfArray = PDFArray.withContext(this.context);
    while (this.bytes.peek() !== CharCodes.RightSquareBracket) {
      const element = this.parseObject(ref);
      pdfArray.push(element);
      this.skipWhitespaceAndComments();
    }
    this.bytes.assertNext(CharCodes.RightSquareBracket);
    return pdfArray;
  }

  protected parseDict(ref?: PDFRef): PDFDict {
    this.bytes.assertNext(CharCodes.LessThan);
    this.bytes.assertNext(CharCodes.LessThan);
    this.skipWhitespaceAndComments();

    const dict: DictMap = new Map();

    while (
      !this.bytes.done() &&
      this.bytes.peek() !== CharCodes.GreaterThan &&
      this.bytes.peekAhead(1) !== CharCodes.GreaterThan
      ) {
      const key = this.parseName();
      const value = this.parseObject(ref);
      dict.set(key, value);
      this.skipWhitespaceAndComments();
    }

    this.skipWhitespaceAndComments();
    this.bytes.assertNext(CharCodes.GreaterThan);
    this.bytes.assertNext(CharCodes.GreaterThan);

    const Type = dict.get(PDFName.of('Type'));

    if (Type === PDFName.of('Catalog')) {
      return PDFCatalog.fromMapWithContext(dict, this.context);
    } else if (Type === PDFName.of('Pages')) {
      return PDFPageTree.fromMapWithContext(dict, this.context);
    } else if (Type === PDFName.of('Page')) {
      return PDFPageLeaf.fromMapWithContext(dict, this.context);
    } else {
      return PDFDict.fromMapWithContext(dict, this.context);
    }
  }

  protected parseDictOrStream(ref?: PDFRef): PDFDict | PDFStream {
    const startPos = this.bytes.position();

    const dict = this.parseDict(ref);

    this.skipWhitespaceAndComments();

    if (
      !this.matchKeyword(Keywords.streamEOF1) &&
      !this.matchKeyword(Keywords.streamEOF2) &&
      !this.matchKeyword(Keywords.streamEOF3) &&
      !this.matchKeyword(Keywords.streamEOF4) &&
      !this.matchKeyword(Keywords.stream)
    ) {
      return dict;
    }

    const start = this.bytes.offset();
    let end: number;

    const Length = dict.get(PDFName.of('Length'));
    if (Length instanceof PDFNumber) {
      end = start + Length.asNumber();
      this.bytes.moveTo(end);
      this.skipWhitespaceAndComments();
      if (!this.matchKeyword(Keywords.endstream)) {
        this.bytes.moveTo(start);
        end = this.findEndOfStreamFallback(startPos);
      }
    } else {
      end = this.findEndOfStreamFallback(startPos);
    }

    let contents = this.bytes.slice(start, end);

    if (this.cryptoFactory && ref) {
      const transform = this.cryptoFactory.createCipherTransform(
        ref.objectNumber,
        ref.generationNumber,
      );
      contents = transform.decryptBytes(contents);
    }

    return PDFRawStream.of(dict, contents);
  }

  protected findEndOfStreamFallback(startPos: Position) {
    // Move to end of stream, while handling nested streams
    let nestingLvl = 1;
    let end = this.bytes.offset();

    while (!this.bytes.done()) {
      end = this.bytes.offset();

      if (this.matchKeyword(Keywords.stream)) {
        nestingLvl += 1;
      } else if (
        this.matchKeyword(Keywords.EOF1endstream) ||
        this.matchKeyword(Keywords.EOF2endstream) ||
        this.matchKeyword(Keywords.EOF3endstream) ||
        this.matchKeyword(Keywords.endstream)
      ) {
        nestingLvl -= 1;
      } else {
        this.bytes.next();
      }

      if (nestingLvl === 0) break;
    }

    if (nestingLvl !== 0) throw new PDFStreamParsingError(startPos);

    return end;
  }
}

export default PDFObjectParser;
