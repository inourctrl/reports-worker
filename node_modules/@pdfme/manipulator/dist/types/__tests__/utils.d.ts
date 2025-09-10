export declare const createTestPDF: (pageCount: number) => Promise<Uint8Array>;
export declare const pdfToImages: (pdf: ArrayBuffer | Uint8Array) => Promise<Buffer[]>;
export declare const getPDFPageCount: (pdf: ArrayBuffer | Uint8Array) => Promise<number>;
