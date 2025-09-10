declare const merge: (pdfs: (ArrayBuffer | Uint8Array)[]) => Promise<Uint8Array>;
declare const split: (pdf: ArrayBuffer | Uint8Array, ranges: {
    start?: number;
    end?: number;
}[]) => Promise<Uint8Array[]>;
declare const remove: (pdf: ArrayBuffer | Uint8Array, pages: number[]) => Promise<Uint8Array>;
declare const insert: (basePdf: ArrayBuffer | Uint8Array, inserts: {
    pdf: ArrayBuffer | Uint8Array;
    position: number;
}[]) => Promise<Uint8Array>;
declare const rotate: (pdf: ArrayBuffer | Uint8Array, degrees: 0 | 90 | 180 | 270 | 360, pageNumbers?: number[]) => Promise<Uint8Array>;
declare const move: (pdf: ArrayBuffer | Uint8Array, operation: {
    from: number;
    to: number;
}) => Promise<Uint8Array>;
declare const organize: (pdf: ArrayBuffer | Uint8Array, actions: Array<{
    type: "remove";
    data: {
        position: number;
    };
} | {
    type: "insert";
    data: {
        pdf: ArrayBuffer | Uint8Array;
        position: number;
    };
} | {
    type: "replace";
    data: {
        pdf: ArrayBuffer | Uint8Array;
        position: number;
    };
} | {
    type: "rotate";
    data: {
        position: number;
        degrees: 0 | 90 | 180 | 270 | 360;
    };
} | {
    type: "move";
    data: {
        from: number;
        to: number;
    };
}>) => Promise<Uint8Array>;
export { merge, split, remove, insert, rotate, move, organize };
