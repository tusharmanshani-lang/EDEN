'use strict';

const fs = require('node:fs/promises');
const { parentPort, workerData } = require('node:worker_threads');

async function readDocument() {
  const { filePath, extension, maxFileBytes, maxTextBytes } = workerData;
  const buffer = await fs.readFile(filePath);
  if (buffer.length > maxFileBytes) {
    throw new Error('The document is too large. Maximum size is 15 MB.');
  }

  let content = '';
  const pages = [];
  const warnings = [];

  if (extension === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer, isEvalSupported: false, verbosity: 0 });

    try {
      const result = await parser.getText({ pageJoiner: '', parseHyperlinks: false });
      let textBytes = 0;
      const emptyPages = [];

      for (const page of result.pages) {
        const text = page.text.replace(/\r\n?/g, '\n').trim();
        textBytes += Buffer.byteLength(text, 'utf8') + 2;
        if (textBytes > maxTextBytes) {
          throw new Error('The extracted document text exceeds the 5 MB reading limit.');
        }
        if (!text) emptyPages.push(page.num);
        if (pages.length) content += '\n\n';
        const start = content.length;
        content += text;
        pages.push({ number: page.num, start, end: content.length });
      }

      if (!content.trim()) {
        throw new Error('This PDF has no extractable text. Scanned pages need OCR.');
      }
      if (emptyPages.length) {
        const displayed = emptyPages.slice(0, 10).join(', ');
        warnings.push(`PDF pages with no extractable text: ${displayed}${emptyPages.length > 10 ? '…' : ''}.`);
      }
    } finally {
      await parser.destroy();
    }
  } else if (extension === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    content = result.value.replace(/\r\n?/g, '\n').trim();
    if (result.messages.some(message => message.type === 'error')) {
      throw new Error('The Word document could not be read completely.');
    }
    if (!content) throw new Error('This Word document has no extractable text.');
    if (result.messages.length) warnings.push('The Word reader reported formatting it could not interpret.');
  } else {
    throw new Error('Unsupported document format.');
  }

  if (Buffer.byteLength(content, 'utf8') > maxTextBytes) {
    throw new Error('The extracted document text exceeds the 5 MB reading limit.');
  }
  return { content, pages, warnings };
}

readDocument().then(
  result => parentPort.postMessage({ result }),
  error => {
    let message = error.message || 'The document could not be read.';
    if (error.name === 'PasswordException') message = 'This PDF is password protected.';
    if (error.code === 'MODULE_NOT_FOUND') message = 'Document readers are missing. Run npm install in EDEN-NEXT, then restart EDEN.';
    parentPort.postMessage({ error: message.slice(0, 500) });
  }
);
