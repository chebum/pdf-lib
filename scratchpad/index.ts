import * as fs from 'fs';
import { PDFDocument } from 'src/index';

(async () => {
  const pdf1Bytes = fs.readFileSync('assets/pdfs/EIA-19353951.pdf') //samplesecured_256bitaes_pdf // assets/pdfs/EIA-19353951.pdf

  const pdfDoc2 = await PDFDocument.load(pdf1Bytes, { ignoreEncryption: true });

  const pdfBytes = await pdfDoc2.save();

  fs.writeFileSync('unencrypt_52.pdf', pdfBytes);
})();
