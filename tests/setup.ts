// Polyfill for File API used by cheerio/undici in Node.js environments
if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File {
    constructor(
      public readonly name: string,
      public readonly lastModified: number = Date.now(),
    ) {}
  } as unknown as typeof File;
}

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    static readonly EMPTY = 0;
    static readonly LOADING = 1;
    static readonly DONE = 2;
    readonly EMPTY = 0;
    readonly LOADING = 1;
    readonly DONE = 2;
    readAsText() {}
    readAsDataURL() {}
    readAsArrayBuffer() {}
  } as unknown as typeof FileReader;
}

// Ensure File is available in global scope for undici
if (typeof (global as typeof globalThis & { File?: typeof File }).File === 'undefined') {
  (global as typeof globalThis & { File: typeof File }).File = globalThis.File as typeof File;
}

