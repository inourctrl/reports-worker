"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPDFPageCount = exports.pdfToImages = exports.createTestPDF = void 0;
const pdf_lib_1 = require("@pdfme/pdf-lib");
const converter_1 = require("@pdfme/converter");
const createTestPDF = async (pageCount) => {
    const pdfDoc = await pdf_lib_1.PDFDocument.create();
    for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.addPage([500, 500]);
        page.drawText(`Page ${i + 1}`, {
            x: 50,
            y: 450,
            size: 20,
        });
    }
    return pdfDoc.save();
};
exports.createTestPDF = createTestPDF;
const pdfToImages = async (pdf) => {
    const arrayBuffers = await (0, converter_1.pdf2img)(pdf, { imageType: 'png' });
    return arrayBuffers.map((buf) => Buffer.from(new Uint8Array(buf)));
};
exports.pdfToImages = pdfToImages;
const getPDFPageCount = async (pdf) => {
    const pdfDoc = await pdf_lib_1.PDFDocument.load(pdf);
    return pdfDoc.getPageCount();
};
exports.getPDFPageCount = getPDFPageCount;
//# sourceMappingURL=utils.js.map