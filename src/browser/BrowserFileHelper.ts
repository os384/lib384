// (c) 2023-2024 384 (tm)

// src/browser/files.ts

// handle browser-to-file-system environment

// NOTA BENE: if you change things here in any fundamental way, make sure it's
// working on multiple browsers, since they have different behaviors in this
// area, some differences are subtle.  We target Firefox, Chrome, Edge, and
// Safari, and on MacOS, Windows, and Linux. It should work on other browsers
// and/or platforms, but we don't necessarily test too carefully on others. In
// fact this code will try several things, all of which do not work on *any* of
// the browsers, but tries to construct a 'union' of information.

// An example is handling empty, eg 'dangling', directories, which we currently
// disable; if you re-enable this, you have work to do.
const SKIP_DIR = true;

// Contrary to our instincts, we try hard to execute synchronously in this code,
// because the order in which bits and pieces of information arrive is
// important. For example, we try to process a directory before it's contents,
// because, depending on the browser, there is sometimes explicit information in
// the directory, in other cases that same information can sometimes be derived
// from the files.

// TODO: does NOT handle two identical files in different directories; this
//       turns out to be a painpoint since rolling up web apps often have
//       the effect of copying files around (eg our documentation)

import { ChannelApi } from 'src/channel/ChannelApi';
import { arrayBufferToBase62 } from 'src/utils/b62';
import { StorageApi } from 'src/storage/StorageApi';
import { SBFile } from 'src/file/SBFile';

const DBG0 = false;
const DBG2 = false; // more verbose
const DEBUG3 = false; // etc

const SEP = '\n' + '-'.repeat(80) + '\n';

//#region HELPER FUNCTIONS ************************************************************************************************

// helper function to pull properties of interest out, resilient
// to what is available on the object/class/whatever
// const fileInfo = { ...getProperties(fileObject, propertyList) };

function getProperties(obj: any, propertyList: Array<string>) {
    const properties: { [key: string]: any } = {};
    // First priority: regular properties (directly on the object)
    propertyList.forEach((property) => {
        if (obj.hasOwnProperty(property)) {
            properties[property] = obj[property];
        }
    });
    // Second priority: own properties (from Object.getOwnPropertyNames)
    Object.getOwnPropertyNames(obj).forEach((property) => {
        if (propertyList.includes(property) && !properties.hasOwnProperty(property)) {
            properties[property] = obj[property];
        }
    });
    // Third priority: properties up the prototype chain (from for...in loop)
    for (const property in obj) {
        if (propertyList.includes(property) && !properties.hasOwnProperty(property)) {
            properties[property] = obj[property];
        }
    }
    return properties;
}

type MagicByte = number | null;
type MagicSignature = MagicByte[];
type MimeTypeSignatures = Record<string, MagicSignature[]>;

/**
 * Tries to figure out MIME type based on file extension and optionally file starting contents.
 * Falls back to "application/octet-stream" if type cannot be determined.
 */
export function getMimeType(fileName: string | undefined, fileStart: ArrayBuffer | Uint8Array | undefined = undefined): string {
    const MIME_TYPES: Record<string, string> = {
        // Mapping of file extensions to MIME types
        // for 'unofficial' mappings, a future [todo] could include reviewing the
        // National Software Reference Library (NSRL) Reference Data Set (RDS) for file types
        '.aac': 'audio/aac',   // AAC audio
        '.abw': 'application/x-abiword',   // AbiWord document
        '.arc': 'application/x-freearc',   // Archive document (multiple files embedded)
        '.avif': 'image/avif',   // AVIF image
        '.avi': 'video/x-msvideo',   // AVI: Audio Video Interleave
        '.azw': 'application/vnd.amazon.ebook',   // Amazon Kindle eBook format
        '.bin': 'application/octet-stream',   // Any kind of binary data
        '.bmp': 'image/bmp',   // Windows OS/2 Bitmap Graphics
        '.bz': 'application/x-bzip',   // BZip archive
        '.bz2': 'application/x-bzip2',   // BZip2 archive
        '.cda': 'application/x-cdf',   // CD audio
        '.csh': 'application/x-csh',   // C-Shell script
        '.css': 'text/css',   // Cascading Style Sheets (CSS)
        '.csv': 'text/csv',   // Comma-separated values (CSV)
        '.doc': 'application/msword',   // Microsoft Word
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // Microsoft Word (OpenXML)
        '.eot': 'application/vnd.ms-fontobject',   // MS Embedded OpenType fonts
        '.epub': 'application/epub+zip',   // Electronic publication (EPUB)
        '.gz': 'application/gzip',   // GZip Compressed Archive
        '.gif': 'image/gif',   // Graphics Interchange Format (GIF)
        '.htm': 'text/html',   // HyperText Markup Language (HTML)
        '.html': 'text/html',   // HyperText Markup Language (HTML)
        '.ico': 'image/vnd.microsoft.icon',   // Icon format
        '.ics': 'text/calendar',   // iCalendar format
        '.jar': 'application/java-archive',   // Java Archive (JAR)
        '.jpeg': 'image/jpeg',   // JPEG images
        '.jpg': 'image/jpeg',   // JPEG images
        '.js': 'text/javascript',   // JavaScript (Specifications: HTML and RFC 9239)
        '.json': 'application/json',   // JSON format
        '.jsonld': 'application/ld+json',   // JSON-LD format
        '.mid': 'audio/midi',   // Musical Instrument Digital Interface (MIDI)
        '.midi': 'audio/midi',   // Musical Instrument Digital Interface (MIDI)
        '.mjs': 'text/javascript',   // JavaScript module
        '.mp3': 'audio/mpeg',   // MP3 audio
        '.mp4': 'video/mp4',   // MP4 video
        '.m4a': 'audio/mp4',   // M4A audio
        '.m4b': 'audio/mp4',   // M4A audio
        '.mpeg': 'video/mpeg',   // MPEG Video
        '.mpkg': 'application/vnd.apple.installer+xml',   // Apple Installer Package
        '.odp': 'application/vnd.oasis.opendocument.presentation',   // OpenDocument presentation document
        '.ods': 'application/vnd.oasis.opendocument.spreadsheet',   // OpenDocument spreadsheet document
        '.odt': 'application/vnd.oasis.opendocument.text',   // OpenDocument text document
        '.oga': 'audio/ogg',   // OGG audio
        '.ogv': 'video/ogg',   // OGG video
        '.ogx': 'application/ogg',   // OGG
        '.opus': 'audio/opus',   // Opus audio
        '.otf': 'font/otf',   // OpenType font
        '.png': 'image/png',   // Portable Network Graphics
        '.pdf': 'application/pdf',   // Adobe Portable Document Format (PDF)
        '.php': 'application/x-httpd-php',   // Hypertext Preprocessor (Personal Home Page)
        '.ppt': 'application/vnd.ms-powerpoint',   // Microsoft PowerPoint
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',   // Microsoft PowerPoint (OpenXML)
        '.rar': 'application/vnd.rar',   // RAR archive
        '.rtf': 'application/rtf',   // Rich Text Format (RTF)
        '.sh': 'application/x-sh',   // Bourne shell script
        '.svg': 'image/svg+xml',   // Scalable Vector Graphics (SVG)
        '.tar': 'application/x-tar',   // Tape Archive (TAR)
        '.tif': 'image/tiff',   // Tagged Image File Format (TIFF)
        '.tiff': 'image/tiff',   // Tagged Image File Format (TIFF)
        '.ts': 'video/mp2t',   // MPEG transport stream
        '.ttf': 'font/ttf',   // TrueType Font
        '.txt': 'text/plain',   // Text, (generally ASCII or ISO 8859-n)
        '.vsd': 'application/vnd.visio',   // Microsoft Visio
        '.wasm': 'application/wasm',   // WebAssembly
        '.wav': 'audio/wav',   // Waveform Audio Format
        '.weba': 'audio/webm',   // WEBM audio
        '.webm': 'video/webm',   // WEBM video
        '.webp': 'image/webp',   // WEBP image
        '.woff': 'font/woff',   // Web Open Font Format (WOFF)
        '.woff2': 'font/woff2',   // Web Open Font Format (WOFF)
        '.xhtml': 'application/xhtml+xml',   // XHTML
        '.xls': 'application/vnd.ms-excel',   // Microsoft Excel
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',   // Microsoft Excel (OpenXML)
        '.xml': 'application/xml',   // XML
        '.xul': 'application/vnd.mozilla.xul+xml',   // XUL
        '.zip': 'application/zip',   // ZIP archive
        '.7z': 'application/x-7z-compressed',   // 7-zip archive
    };

    // Magic numbers for content-based detection
    const MAGIC_NUMBERS: MimeTypeSignatures = {
        // Images
        'image/jpeg': [[0xFF, 0xD8, 0xFF]], // .jpg, .jpeg
        'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]], // .png
        'image/gif': [
            [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
            [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]  // GIF89a
        ],
        'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]],
        'image/avif': [[0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]],
        'image/heic': [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]],
        'image/bmp': [[0x42, 0x4D]],

        // Documents
        'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // .pdf
        'application/rtf': [[0x7B, 0x5C, 0x72, 0x74, 0x66]], // .rtf
        'application/msword': [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]], // .doc
        'application/vnd.openxmlformats-officedocument': [[0x50, 0x4B, 0x03, 0x04]], // .docx, .pptx, .xlsx
        'application/epub+zip': [[0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]], // .epub

        // Archives
        'application/zip': [[0x50, 0x4B, 0x03, 0x04]], // .zip
        'application/x-rar-compressed': [[0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]], // .rar
        'application/x-7z-compressed': [[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]], // .7z
        'application/gzip': [[0x1F, 0x8B, 0x08]], // .gz

        // Audio
        'audio/aac': [[0xFF, 0xF1], [0xFF, 0xF9]], // .aac
        'audio/mpeg': [
            [0x49, 0x44, 0x33], // MP3 with ID3v2
            [0xFF, 0xFB],       // MP3 raw
            [0xFF, 0xF3],       // MP3 raw
            [0xFF, 0xF2]        // MP3 raw
        ],
        'audio/wav': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x41, 0x56, 0x45]], // .wav
        'audio/flac': [[0x66, 0x4C, 0x61, 0x43]], // .flac

        // Video
        'video/mp4': [
            [0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D], // ISO Base Media
            [0x66, 0x74, 0x79, 0x70, 0x6D, 0x70, 0x34, 0x32]  // MP4v2
        ],
        'video/x-matroska': [[0x1A, 0x45, 0xDF, 0xA3]], // .mkv
        'video/quicktime': [[0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]], // .mov
        'video/3gpp': [[0x66, 0x74, 0x79, 0x70, 0x33, 0x67]], // .3gp
        'video/3gpp2': [[0x66, 0x74, 0x79, 0x70, 0x33, 0x67, 0x32]], // .3g2
        'video/x-msvideo': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x41, 0x56, 0x49, 0x20]], // .avi

        // Fonts
        'font/ttf': [[0x00, 0x01, 0x00, 0x00, 0x00]], // .ttf
        'font/otf': [[0x4F, 0x54, 0x54, 0x4F, 0x00]], // .otf
        'font/woff': [[0x77, 0x4F, 0x46, 0x46]], // .woff
        'font/woff2': [[0x77, 0x4F, 0x46, 0x32]], // .woff2

        // Executables and Binaries
        'application/x-msdownload': [[0x4D, 0x5A]], // .exe
        'application/x-elf': [[0x7F, 0x45, 0x4C, 0x46]], // .elf
        'application/wasm': [[0x00, 0x61, 0x73, 0x6D]], // .wasm
        'application/x-sqlite3': [[0x53, 0x51, 0x4C, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6F, 0x72, 0x6D, 0x61, 0x74]], // .sqlite
        'application/java-vm': [[0xCA, 0xFE, 0xBA, 0xBE]] // .class
    };

    function matchSignature(buffer: Uint8Array, signature: MagicSignature): boolean {
        if (buffer.length < signature.length) return false;
        return signature.every((byte, index) =>
            byte === null || buffer[index] === byte
        );
    }

    function detectFromContent(buffer: ArrayBuffer | Uint8Array): string | null {
        const uint8Array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        for (const [mimeType, signatures] of Object.entries(MAGIC_NUMBERS)) {
            for (const signature of signatures) {
                if (matchSignature(uint8Array, signature)) {
                    return mimeType;
                }
            }
        }
        // Check for text files; probabilistic, we're only checking first 32 bytes
        const isText = uint8Array.length > 0 &&
            Array.from(uint8Array.slice(0, Math.min(32, uint8Array.length)))
                .every(byte => byte === 0x09 || byte === 0x0A || byte === 0x0D || (byte >= 0x20 && byte <= 0x7E));
        return isText ? 'text/plain' : null;
    }

    // Primarily we make a decision based on file name extension
    if (fileName) {
        const fileExtension = fileName.trim().toLowerCase().slice(fileName.lastIndexOf('.'));
        const mimeFromExt = MIME_TYPES[fileExtension];
        if (mimeFromExt && fileStart) {
            // If we have both extension and content, verify consistency
            const mimeFromContent = detectFromContent(fileStart);
            if (mimeFromContent && mimeFromContent !== mimeFromExt) {
                console.warn(
                    `File extension suggests ${mimeFromExt} but content suggests ${mimeFromContent}. ` +
                    `Using extension-based type.`
                );
            }
        }
        if (mimeFromExt) return mimeFromExt;
    }

    // If we don't have a file name, or no extension, or unknown extension, try content-based detection
    if (fileStart) {
        const mimeFromContent = detectFromContent(fileStart);
        if (mimeFromContent) return mimeFromContent;
    }

    // If we can't figure anything out we default to generic binary
    return 'application/octet-stream';
}

// older version, only considered file name
// export function getMimeType(fileName: string | undefined, fileStart: ArrayBuffer | Uint8Array | undefined): string {
//     if (!fileName) return "application/octet-stream";
//     fileName = fileName.trim().toLowerCase();
//     const MIME_TYPES: Record<string, string> = {
//         '.aac': 'audio/aac',   // AAC audio
//         '.abw': 'application/x-abiword',   // AbiWord document
//         '.arc': 'application/x-freearc',   // Archive document (multiple files embedded)
//         '.avif': 'image/avif',   // AVIF image
//         '.avi': 'video/x-msvideo',   // AVI: Audio Video Interleave
//         '.azw': 'application/vnd.amazon.ebook',   // Amazon Kindle eBook format
//         '.bin': 'application/octet-stream',   // Any kind of binary data
//         '.bmp': 'image/bmp',   // Windows OS/2 Bitmap Graphics
//         '.bz': 'application/x-bzip',   // BZip archive
//         '.bz2': 'application/x-bzip2',   // BZip2 archive
//         '.cda': 'application/x-cdf',   // CD audio
//         '.csh': 'application/x-csh',   // C-Shell script
//         '.css': 'text/css',   // Cascading Style Sheets (CSS)
//         '.csv': 'text/csv',   // Comma-separated values (CSV)
//         '.doc': 'application/msword',   // Microsoft Word
//         '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // Microsoft Word (OpenXML)
//         '.eot': 'application/vnd.ms-fontobject',   // MS Embedded OpenType fonts
//         '.epub': 'application/epub+zip',   // Electronic publication (EPUB)
//         '.gz': 'application/gzip',   // GZip Compressed Archive
//         '.gif': 'image/gif',   // Graphics Interchange Format (GIF)
//         '.htm': 'text/html',   // HyperText Markup Language (HTML)
//         '.html': 'text/html',   // HyperText Markup Language (HTML)
//         '.ico': 'image/vnd.microsoft.icon',   // Icon format
//         '.ics': 'text/calendar',   // iCalendar format
//         '.jar': 'application/java-archive',   // Java Archive (JAR)
//         '.jpeg': 'image/jpeg',   // JPEG images
//         '.jpg': 'image/jpeg',   // JPEG images
//         '.js': 'text/javascript',   // JavaScript (Specifications: HTML and RFC 9239)
//         '.json': 'application/json',   // JSON format
//         '.jsonld': 'application/ld+json',   // JSON-LD format
//         '.mid': 'audio/midi',   // Musical Instrument Digital Interface (MIDI)
//         '.midi': 'audio/midi',   // Musical Instrument Digital Interface (MIDI)
//         '.mjs': 'text/javascript',   // JavaScript module
//         '.mp3': 'audio/mpeg',   // MP3 audio
//         '.mp4': 'video/mp4',   // MP4 video
//         '.m4a': 'audio/mp4',   // M4A audio
//         '.m4b': 'audio/mp4',   // M4A audio
//         '.mpeg': 'video/mpeg',   // MPEG Video
//         '.mpkg': 'application/vnd.apple.installer+xml',   // Apple Installer Package
//         '.odp': 'application/vnd.oasis.opendocument.presentation',   // OpenDocument presentation document
//         '.ods': 'application/vnd.oasis.opendocument.spreadsheet',   // OpenDocument spreadsheet document
//         '.odt': 'application/vnd.oasis.opendocument.text',   // OpenDocument text document
//         '.oga': 'audio/ogg',   // OGG audio
//         '.ogv': 'video/ogg',   // OGG video
//         '.ogx': 'application/ogg',   // OGG
//         '.opus': 'audio/opus',   // Opus audio
//         '.otf': 'font/otf',   // OpenType font
//         '.png': 'image/png',   // Portable Network Graphics
//         '.pdf': 'application/pdf',   // Adobe Portable Document Format (PDF)
//         '.php': 'application/x-httpd-php',   // Hypertext Preprocessor (Personal Home Page)
//         '.ppt': 'application/vnd.ms-powerpoint',   // Microsoft PowerPoint
//         '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',   // Microsoft PowerPoint (OpenXML)
//         '.rar': 'application/vnd.rar',   // RAR archive
//         '.rtf': 'application/rtf',   // Rich Text Format (RTF)
//         '.sh': 'application/x-sh',   // Bourne shell script
//         '.svg': 'image/svg+xml',   // Scalable Vector Graphics (SVG)
//         '.tar': 'application/x-tar',   // Tape Archive (TAR)
//         '.tif': 'image/tiff',   // Tagged Image File Format (TIFF)
//         '.tiff': 'image/tiff',   // Tagged Image File Format (TIFF)
//         '.ts': 'video/mp2t',   // MPEG transport stream
//         '.ttf': 'font/ttf',   // TrueType Font
//         '.txt': 'text/plain',   // Text, (generally ASCII or ISO 8859-n)
//         '.vsd': 'application/vnd.visio',   // Microsoft Visio
//         '.wasm': 'application/wasm',   // WebAssembly
//         '.wav': 'audio/wav',   // Waveform Audio Format
//         '.weba': 'audio/webm',   // WEBM audio
//         '.webm': 'video/webm',   // WEBM video
//         '.webp': 'image/webp',   // WEBP image
//         '.woff': 'font/woff',   // Web Open Font Format (WOFF)
//         '.woff2': 'font/woff2',   // Web Open Font Format (WOFF)
//         '.xhtml': 'application/xhtml+xml',   // XHTML
//         '.xls': 'application/vnd.ms-excel',   // Microsoft Excel
//         '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',   // Microsoft Excel (OpenXML)
//         '.xml': 'application/xml',   // XML
//         '.xul': 'application/vnd.mozilla.xul+xml',   // XUL
//         '.zip': 'application/zip',   // ZIP archive
//         '.7z': 'application/x-7z-compressed',   // 7-zip archive
//     };
//     // Extract the file extension from the file name
//     const fileExtension = fileName.slice(fileName.lastIndexOf('.'));
//     // Return the MIME type if it exists in the mapping, or an empty string otherwise
//     const t = MIME_TYPES[fileExtension];
//     if (t) return t;
//     else {
//         console.warn(`Cannot figure out MIME type for file extension ${fileExtension}, will use 'application/octet-stream'`);
//         return "application/octet-stream"
//     }
// }

//#endregion HELPER FUNCTIONS ************************************************************************************************

//#region TYPESCRIPT TYPES ETC ************************************************************************************************

// browser behavior is not always captured by standard typescript headers, for
// example, Microsoft header files don't support some Safari behavior; so we
// need some definitions of our own

// FileEntry is non standard ... so we need to have some definitions 
interface Entry {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    fullPath: string;
    filesystem: FileSystem;
    getMetadata(successCallback: MetadataCallback, errorCallback?: ErrorCallback): void;
}
interface FileSystemFileEntry extends Entry {
    isFile: true;
    isDirectory: false;
    file(successCallback: FileCallback, errorCallback?: ErrorCallback): void;
}

interface Metadata {
    modificationTime: Date;
    size: number;
}
type MetadataCallback = (metadata: Metadata) => void;
type ErrorCallback = (error: DOMException) => void;
type FileCallback = (file: File) => void;

interface CustomEventTarget extends EventTarget {
    files?: FileList;
    items?: DataTransferItemList;
}

/** @internal */
export interface BrowserFileMetaData {
    name?: string;
    fullPath?: string;
    size?: number;
    type?: string;
    file?: (successCallback: FileCallback, errorCallback?: ErrorCallback) => void;
    lastModified?: number;
    lastModifiedDate?: Date;
    webkitRelativePath?: string;
    isDirectory?: boolean;
    isFile?: boolean;
    getMetaDataName?: string;
    getMetaDataSize?: number;
    getMetaDataType?: string;
    getMetaDataLastModified?: number;
    getMetaDataGetFileError?: any;
    getMetaDataModificationTime?: Date;
    getMetaDataFile?: File;
    getMetaDataError?: string;
    noGetMetaData?: boolean;
}

//#endregion TYPESCRIPT TYPES ETC ************************************************************************************************

// these are the properties that we (potenially) care about
const propertyList = [
    'lastModified', 'name', 'type', 'size', 'webkitRelativePath', 'fullPath', 'isDirectory', 'isFile',
    'SBitemNumber', 'SBitemNumberList', 'fileContentCandidates', 'fileContents', /* 'uniqueShardId', */ 'hash', // 20220320
    'SBparentEntry', 'SBparentNumber', 'SBfoundMetaData', 'SBfullName',
    'browserFile', 'SBdirectoryReader', 'motherObject', 'webkitRelativePath',
];

// Global counter utility; works well with async/await etc
const createCounter = () => {
    let counter = 0;
    const inc = async (): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, 0)); // Simulate asynchronous operation
        counter++;
        return counter - 1; // we count starting at zero
    };
    return { inc };
};

let printedWarning = false;

/** @internal */
export function printWarning() {
    if (!printedWarning) {
        console.log("================================================")
        console.log("Warning: you are running in 'local web page' mode")
        console.log("on a browser that has some restrictions.");
        console.log("");
        console.log("So far, looks like this browser will not let you");
        console.log("navigate *into* directories that are drag-and-dropped");
        console.log("Might also be having issues getting meta data,");
        console.log("as well as getting the 'full' path of the file.");
        console.log("============================================")
        printedWarning = true;
    }
    if ((globalThis as any).directoryDropText)
        (globalThis as any).directoryDropText!.innerHTML = "Click to choose directories<br />(drag and drop might not work))";

}

class BrowserFile extends SBFile {
    fileContentCandidates?: Array<BrowserFile>;
    isDirectory?: boolean;
    isFile?: boolean;
    motherObject?: File | FileSystemEntry | FileSystemFileEntry
    SBdirectoryReader?: FileSystemDirectoryReader;
    SBfoundMetaData?: any
    SBfullName?: string;
    SBitemNumber?: number;
    SBitemNumberList?: Array<number>;
    SBparentEntry?: FileSystemEntry | FileSystemFileEntry;
    SBparentNumber?: number;
    webkitRelativePath?: string;

    constructor(fileInfo?: {
        [key: string]: any;
    }) {
        super(fileInfo);
        this.fileContentCandidates = fileInfo?.fileContentCandidates;
        this.isDirectory = fileInfo?.isDirectory;
        this.isFile = fileInfo?.isFile;
        this.motherObject = fileInfo?.motherObject;
        this.SBdirectoryReader = fileInfo?.SBdirectoryReader;
        this.SBfoundMetaData = fileInfo?.SBfoundMetaData;
        this.SBfullName = fileInfo?.SBfullName;
        this.SBitemNumber = fileInfo?.SBitemNumber;
        this.SBitemNumberList = fileInfo?.SBitemNumberList;
        this.SBparentEntry = fileInfo?.SBparentEntry;
        this.SBparentNumber = fileInfo?.SBparentNumber;
        this.webkitRelativePath = fileInfo?.webkitRelativePath;
    }
}

/**
 * This class supports parsing any files or directories that have been selected
 * by the UI, whether through a file input or a drag-and-drop operation
 *
 * The key data structures to access are (both global):
 *
 *   finalFileList: a map of all files that have been processed (maps from 'full
 *                  file name' in the context of the set, to SBFile)
 *
 * globalBufferMap: a map of all array buffers that have been read (or 'seen');
 *                  maps hash (of contents) to ArrayBuffers
 *
 * These are accumulative and do not reset on any UI interaction that this class
 * can see: they need to be explicitly cleared by the application.
 * 
 * Here is roughly how you would wire things up from a UI:
 * 
 *   const sbFileHelper = new BrowserFileHelper();
 * 
 *   const fileDropZone = document.getElementById('fileDropZone');
 *   const directoryDropZone = document.getElementById('directoryDropZone');
 *
 *   fileDropZone.addEventListener('drop', fileHelper.handleFileDrop);
 *   directoryDropZone.addEventListener('drop', fileHelper.handleDirectoryDrop);
 *
 *   fileDropZone.addEventListener('click', fileHelper.handleFileClick);
 *   directoryDropZone.addEventListener('click', fileHelper.handleDirectoryClick);
 *
 * Note that browsers _fundamentally_ differ on these four different ways of getting
 * files into a browser (eg either 'drop' or 'click', and from a )
 * 
 * @public
 */
export class BrowserFileHelper {

    // public static version = "20240407.2"

    // accumulative; any files this class sees and understands are added; each
    // BrowserFileHelper has it's own set. note that this can be modified
    // externally, including cleared.
    public finalFileList: Map<string, SBFile> = new Map();

    public currentFileList: Array<SBFile> = [];

    // buffers (file contents) are tracked in two places, and any given one
    // should _not_ be in both. there is 'ChannelApi.knownShards', shards that
    // we've seen and know the handle for; and 'knownBuffers' buffers we (any
    // BrowserFileHelper) have seen but are NOT in knownShards; meaning, they have
    // either not been saved (yet), or we just don't know the handle.

    public static knownBuffers = new Map<string, ArrayBuffer>();

    // knownShards moved to ChannelApi.knownShards
    // public static knownShards: Map<string, ObjectHandle> = new Map();

    // set of file names that should be ignored (e.g. .DS_Store)
    #ignoreFileSet = new Set()

    // give any file or item 'seen' by this instance a unique number (reset on
    // every UI interaction)
    #itemNumber = createCounter();

    // if there are items, files will at first be numbered the same (reset on
    // every UI interaction)
    #fileItemNumber = createCounter();

    // all of our scanning results go here, unabridged (reset on every UI interaction)
    #globalFileMap: Map<string, BrowserFile> = new Map();

    // this is the distilled list of files we will add to finalFileList (reset on every UI interaction)
    #currentFileList: Map<string, BrowserFile> = new Map();

    // 20220320 - changing this, given changes to storage api
    // // (global) track all (unique) array buffers that have been read (NOT reset)
    // // todo: strictly speaking we don't garbage collect this
    // public static globalBufferMap = new Map();

    constructor(
        public callbacks: {
            processNewTable?: (table: Array<SBFile>) => void,
            // uploadSet: (set: Array<SBFile>) => void,
        }
    ) {
        // add some files to ignore, if the come along with a drag-and-drop
        this.#ignoreFileSet.add(".DS_Store");
        this.#ignoreFileSet.add("/.DS_Store");
        // add a regex to catch emacs backup files
        this.#ignoreFileSet.add(/.*~$/);
        // console.log(this)
    }

    /**
     * Adds file type to the 'ignore' list.
     */
    ignoreFile(fileName: string): boolean {
        if (this.#ignoreFileSet.has(fileName)) return true;
        for (let ignoreFile of this.#ignoreFileSet)
            if (ignoreFile instanceof RegExp)
                if (ignoreFile.test(fileName))
                    return true;
        return false;
    }

    //#region SCAN ITEMS AND FILES ****************************************************************************************

    // these are called by the UI code to parse any files or directories that have been selected
    // by the UI, whether through a file input or a drag-and-drop operation

    // returns metadata for a file object whether it is a File or FileEntry
    private extractFileMetadata(fileObject: File | FileSystemEntry | FileSystemFileEntry): Promise<BrowserFileMetaData> {
        function localResolve(metadata: BrowserFileMetaData): BrowserFileMetaData {
            // console.log("Extracted metadata:");
            // console.log(metadata);
            return metadata;
        }
        return new Promise<BrowserFileMetaData>((resolve) => {
            const metadata: BrowserFileMetaData = {} as BrowserFileMetaData;
            // console.log("Extracting metadata from object:");
            // console.log(fileObject);
            if (fileObject instanceof File) {
                if (fileObject.name)
                    metadata.name = fileObject.name;
                if (fileObject.size)
                    metadata.size = fileObject.size;
                if (fileObject.type)
                    metadata.type = fileObject.type;
                if (fileObject.lastModified)
                    metadata.lastModified = fileObject.lastModified;
                if (fileObject.webkitRelativePath)
                    metadata.webkitRelativePath = fileObject.webkitRelativePath;
            }
            if ((typeof FileSystemEntry !== "undefined") && (fileObject instanceof FileSystemEntry)) {
                if (fileObject.name)
                    metadata.name = fileObject.name;
                if (fileObject.fullPath)
                    metadata.fullPath = fileObject.fullPath;
                if (fileObject.isDirectory !== undefined)
                    metadata.isDirectory = fileObject.isDirectory;
                if (fileObject.isFile !== undefined)
                    metadata.isFile = fileObject.isFile;
                metadata.noGetMetaData = true;
            }
            if ((typeof FileSystemFileEntry !== "undefined") && (fileObject instanceof FileSystemFileEntry)) {
                if (fileObject.fullPath)
                    metadata.fullPath = fileObject.fullPath;
                // if it's there, not so important:
                // if (fileObject.lastModifiedDate)
                //     metadata.lastModifiedDate = fileObject.lastModifiedDate;
                if (fileObject.isDirectory !== undefined)
                    metadata.isDirectory = fileObject.isDirectory;
                if (fileObject.isFile !== undefined)
                    metadata.isFile = fileObject.isFile;
                if (fileObject.file)
                    metadata.file = fileObject.file;
            }
            if ((typeof FileSystemFileEntry !== "undefined") && ((fileObject instanceof FileSystemFileEntry))
                && ((fileObject as unknown as FileSystemFileEntry).getMetadata)) {
                // this is the only situation where we have another promise 
                (fileObject as unknown as FileSystemFileEntry).getMetadata((fileMetadata) => {
                    // console.log("Got meta data from file object:");
                    // console.log(fileMetadata);
                    // metadata.getMetaDataName = fileMetadata.name; // apparently not available?
                    metadata.getMetaDataSize = fileMetadata.size;
                    metadata.getMetaDataModificationTime = fileMetadata.modificationTime;
                    if (fileObject.file) fileObject.file((file) => {
                        metadata.getMetaDataFile = file;
                        metadata.getMetaDataType = file.type;
                        resolve(localResolve(metadata));
                    }, (error) => {
                        metadata.getMetaDataGetFileError = error;
                        resolve(localResolve(metadata));
                    });
                }, (error: any) => {
                    metadata.getMetaDataError = error;
                    resolve(localResolve(metadata));
                });
            } else {
                // otherwise, all info should be immediately available
                metadata.noGetMetaData = true;
                resolve(localResolve(metadata));
            }
        });
    }

    private async scanFile(file: File | FileSystemEntry | FileSystemFileEntry, fromItem: number) {
        if (!file) return
        // if (DBG2) testToRead(file, 'scanFile');
        if (this.ignoreFile(file.name)) return;

        let path: string;
        if (file instanceof File) {
            path = file.webkitRelativePath;
        } else if (file instanceof FileSystemEntry) {
            path = file.fullPath;
        } else if (file instanceof FileSystemFileEntry) {
            path = file.fullPath;
        } else {
            console.warn("**** Unknown file type (should not happen):");
            console.log(file);
            return;
        }

        let fileNumber = await (fromItem === -1 ? this.#fileItemNumber.inc() : fromItem);
        (file as any).SBitemNumber = fileNumber;

        let fromItemText = fromItem === -1 ? '' : ` (from item ${fromItem})`

        // fileListFile1_Files.push(file);

        await this.extractFileMetadata(file).then((metadata) => {
            if (DBG2) console.log(`adding ${fileNumber}`);
            (file as any).SBfoundMetaData = metadata

            // globalFileMap.set(`file ${fileNumber} (item ${fromItem}): ` + "/" + metadata.name + " [file] [2] (" + metadata.size + ")", file);
            // if ((file instanceof File) && (file.type !== "")) {
            //     globalFileMap.set(`file ${fileNumber} (item ${fromItem}): ` + "/" + metadata.name + " [meta from file]", metadata);
            // }

            const b = new BrowserFile(getProperties(file, propertyList));
            b.motherObject = file
            let key = `file ${fileNumber} ${fromItemText} `
            key += path === '' ? `name: '/` + file.name + "' " : `path: '/` + path + "' ";
            this.#globalFileMap.set(key, b);

            // if (path === '') {
            //     // fileListFile1.push('/' + file.name);
            //     this.#globalFileMap.set(`file ${fileNumber} ${fromItemText} name: '/` + file.name + "' ", b);
            // } else {
            //     // fileListFile1.push('/' + path);
            //     this.#globalFileMap.set(`file ${fileNumber} ${fromItemText} path: '/` + path + "'", b);
            // }

        }).catch((error) => {
            console.log("Error getting meta data for FILE (should NOT happen):")
            console.log(file)
            console.log(error);
        });
    }

    private scanFileList(files: FileList | undefined) {
        if (!files) return;
        if (DBG0) console.log(`==== scanFileList called, files.length: ${files.length}`);
        if (files)
            for (let i = 0; i < files.length; i++)
            /* await */ this.scanFile(files[i], -1);
    }

    private async scanItem(item: FileSystemEntry | FileSystemFileEntry | null, parent: any) {
        if (!item) return;
        if (this.ignoreFile(item.name)) return;
        // if (DBG2) testToRead(item, 'scanItem');

        let itemNumber = await this.#itemNumber.inc();

        if (DBG2) { console.log(`scanItem ${itemNumber} ${item.name}`); console.log(item); }

        let parentString = '';
        (item as any).SBitemNumber = itemNumber;
        if (parent !== null) {
            (item as any).SBparentEntry = parent;
            (item as any).SBparentNumber = parent.SBitemNumber;
            parentString = ` (parent ${parent.SBitemNumber}) `;
            if (!parent.SBfullName)
                // if we're a child then parent must be a parent
                parent.SBfullName = parent.name;
            // only if parents are around do we assert any knowledge of path
            (item as any).SBfullName = parent.SBfullName + "/" + item.name;
        }

        // if (item.fullPath)
        //     globalFileMap.set(`item ${itemNumber}: ` + item.fullPath + ` [item] [0] - indent ${indent}`, item);

        // globalFileMap.set(`item ${itemNumber}: ` + '/' + item.name + ` [item] [1] - indent ${indent}`, item);

        await this.extractFileMetadata(item).then((metadata) => {
            (item as any).SBfoundMetaData = metadata
            // globalFileMap.set(`item ${itemNumber}: ` + item.fullPath + ` [item] [2] - indent ${indent} `, item);
            // globalFileMap.set(`item ${itemNumber}: ` + item.fullPath + ` [meta from item] - indent ${indent} `, metadata);
        }).catch((error) => {
            console.log("Error getting meta data for ITEM (should not happen):")
            console.log(item)
            console.log(error);
        });

        if (item.isDirectory) {
            const myThis = this; // workaround (VS issue?)
            let directoryReader = (item as unknown as FileSystemDirectoryEntry).createReader();
            const b = new BrowserFile(getProperties(item, propertyList));
            // (item as any).SBdirectoryReader = directoryReader;
            b.SBdirectoryReader = directoryReader;
            // this.#globalFileMap.set(`item ${itemNumber}: '/` + item.name + `' [directory] ${parentString}`, item);
            this.#globalFileMap.set(`item ${itemNumber}: '/` + item.name + `' [directory] ${parentString}`, b);
            directoryReader.readEntries(function (entries) {
                entries.forEach(async function (entry) {
                    await myThis.scanItem(entry, item);
                });
            }, function (error: any) {
                printWarning();
                if (DBG0) console.log(`Browser restriction: Unable to process this item as directory, '${item.name}':`);
                if (DBG2) console.log(error)
            });
        } else {
            const b = new BrowserFile(getProperties(item, propertyList));
            // this.#globalFileMap.set(`item ${itemNumber}: '/` + item.name + "' " + parentString, item);
            this.#globalFileMap.set(`item ${itemNumber}: '/` + item.name + "' " + parentString, b);
            (item as FileSystemFileEntry).file((file) => {
                b.browserFile = file;
                this.scanFile(file, itemNumber);
            }, function () {
                printWarning();
            });
        }

    }

    scanItemList(items: DataTransferItemList | undefined) {
        if (!items) return;
        if (DBG0) console.log(`==== scanItemList called, items.length: ${items.length}`);
        // console.log(items);
        for (let i = 0; i < items.length; i++) {
            let item = items[i].webkitGetAsEntry();
            if (item) /* await */ this.scanItem(item, null);
            else { console.log("just FYI, not a file/webkit entry:"); console.log(items[i]); }
        }
    }
    //#endregion SCAN ITEMS OR FILES *******************************************************************************************************


    // called after every user interaction (eg any possible additions of one or
    // more files); callback is given current (possibly updated) file list
    private afterOperation(callback: (table: Array<SBFile>) => void) {
        setTimeout(() => {
            (async () => {
                console.log("-------DONE building #globalFileMap---------")
                console.log(this.#globalFileMap);
                console.log("--------------------------------------------")

                let nameToFullPath = new Map<string, string>();

                let candidateFileList: Map<number | string, BrowserFile> = new Map();

                // everything we 'saw' in all manner of processing events gets put on #globalFileMap;
                // here we do a first pass to gather metadata and coalesce into candidateFileList
                this.#globalFileMap.forEach((value, _key) => {
                    if (!value.name) throw new Error("Should not happen (L653)");
                    if (!this.ignoreFile(value.name)) {
                        if (DBG2) { console.log(`[${value.name}] Processing global file map entry: `); console.log(value); }
                        if (value.SBitemNumber !== undefined) {
                            let currentInfo = candidateFileList.get(value.SBitemNumber);
                            if (currentInfo) {
                                // let altFullPath = value.fullPath;
                                // let altFileContentCandidates = value.fileContentCandidates;
                                let newInfo = getProperties(value, propertyList);
                                // Object.assign(currentInfo, getProperties(value, propertyList));
                                Object.assign(newInfo, currentInfo);
                                if ((value.fullPath) && ((!newInfo.fullPath) || (value.fullPath.length > newInfo.fullPath.length)))
                                    newInfo.fullPath = value.fullPath;
                                newInfo.fileContentCandidates.push(value);
                                // currentInfo.fileContentCandidates = altFileContentCandidates;
                                candidateFileList.set(value.SBitemNumber, new BrowserFile(newInfo));
                            } else {
                                // candidateFileList.set(value.SBitemNumber, Object.assign({}, getProperties(value, propertyList)));
                                candidateFileList.set(value.SBitemNumber, new BrowserFile(getProperties(value, propertyList)));
                                currentInfo = candidateFileList.get(value.SBitemNumber);
                                if (!currentInfo) throw new Error("Should not happen (L669)");
                                currentInfo.fileContentCandidates = [value];
                            }
                        } else if (value.fullPath) {
                            // in some cases we can pick up path from here
                            if (DBG2) console.log(`++++ adding path info for '${value.name}':\n`, value.fullPath, value);
                            nameToFullPath.set(value.name, value.fullPath);
                        } else {
                            throw new Error(`++++ file '${value.name}' has neither an SBitemNumber nor a fullPath (L664)`);
                        }
                    } else {
                        if (DBG2) console.log(`Ignoring file '${value.name}' (based on ignoreFile)`);
                    }
                });

                console.log("-------DONE building candidateFileList---------")
                console.log(candidateFileList);
                console.log("-----------------------------------------------")

                // now merge into #currentFileList
                candidateFileList.forEach((value, key) => {
                    if ((value.SBfullName !== undefined) && (("/" + value.SBfullName) !== value.fullPath)) {
                        console.warn("WARNING: SBfullName and fullPath/name do not match");
                        console.log(`Name: ${value.name}, fullPath: ${value.fullPath}, SBfullName: ${value.SBfullName}`);
                        console.log(value)
                    }
                    // pullPath is not reliable in the absence of our ability to reconstruct from parent-child
                    let uniqueName = value.SBfullName || value.webkitRelativePath + '/' + value.name;
                    /* if ((value.isDirectory) && (SKIP_DIR)) {
                        if (DBG0) console.log(`Skipping directory '${uniqueName}'`);
                    } else */ if (uniqueName !== undefined) {
                        if (value.isDirectory === true) {
                            uniqueName += " [directory]";
                        } else if (value.isFile === true) {
                            uniqueName += " [file]";
                        }
                        if ((value.size !== undefined) && (value.isDirectory !== true)) {
                            uniqueName += ` [${value.size} bytes]`;
                        }
                        if (value.lastModified !== undefined) {
                            uniqueName += ` [${value.lastModified}]`;
                        }
                        if (DBG2) {
                            console.log(`processing object ${key} unique name '${uniqueName}':`);
                            console.log(value)
                        }
                        let currentInfo = this.#currentFileList.get(uniqueName);
                        if (currentInfo) {
                            let altFullPath = currentInfo.fullPath;
                            let altFileContentCandidates = currentInfo.fileContentCandidates;
                            let altSbItemNumberList = currentInfo.SBitemNumberList;
                            Object.assign(currentInfo, getProperties(value, propertyList));
                            if ((altFullPath) && ((!currentInfo.fullPath) || (altFullPath.length > currentInfo.fullPath.length)))
                                currentInfo.fullPath = altFullPath;
                            if (altFileContentCandidates) {
                                if (currentInfo.fileContentCandidates === undefined) currentInfo.fileContentCandidates = [];
                                currentInfo.fileContentCandidates.push(...altFileContentCandidates);
                            }
                            if (!altSbItemNumberList || value.SBitemNumber === undefined) throw new Error("Should not happen (L724)");
                            altSbItemNumberList.push(value.SBitemNumber);
                            currentInfo.SBitemNumberList = altSbItemNumberList;
                        } else {
                            if (value.SBitemNumber === undefined) throw new Error("Should not happen (L739)")
                            value.SBitemNumberList = [value.SBitemNumber];
                            this.#currentFileList.set(uniqueName, value);
                            currentInfo = candidateFileList.get(uniqueName); // ToDo: is this the right key?
                        }
                        if (DBG2) {
                            console.log(`... currentInfo for '${uniqueName}' (${uniqueName}):`);
                            console.log(currentInfo);
                        }
                    } else {
                        if (DBG0) {
                            console.log(`++++ ignoring file - it's lacking fullPath (should be rare)`);
                            console.log(value);
                        }
                    }
                });

                console.log("-------DONE building #currentFileList---------")
                console.log(this.#currentFileList)
                console.log("----------------------------------------------")

                // next phase, we'll try reading all the files, and we try to gather any missing metadata

                // attempts to read a single file, returns promise with contents, or null if not readable
                async function readFileAsArrayBuffer(file: Blob): Promise<ArrayBuffer | null> {
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            if ((e.target === null) || (e.target.result === null)) {
                                resolve(null);
                            } else if (typeof e.target.result === 'string') {
                                resolve(null);
                            } else {
                                resolve(e.target.result);
                            }
                        };
                        reader.onerror = () => {
                            reject(new Error('File reading failed'));
                        };
                        reader.readAsArrayBuffer(file);
                    });
                }
                
                async function getFileObject(fileEntry: FileSystemEntry | FileSystemFileEntry): Promise<File | null> {
                    if ('file' in fileEntry) {
                        return new Promise((resolve, reject) => {
                            fileEntry.file(resolve, reject);
                        });
                    }
                    return null;
                }
                                
                // will attempt to read from this; if it succeeds, will return what 'worked' with first chunk, or null if any issues
                // async function FP(file: File | FileSystemEntry | FileSystemFileEntry): Promise<{ file: File, buffer: ArrayBuffer } | null> {
                async function FP(file: BrowserFile): Promise<{ file: File, buffer: ArrayBuffer } | null> {
                    if (!file || !file.motherObject) return null;
                    try {
                        const fileObject: File | null =
                            file.motherObject instanceof File
                                ? file.motherObject
                                : await getFileObject(file.motherObject as FileSystemEntry | FileSystemFileEntry);
                
                        if (!fileObject) return null;
                
                        // we only 'test' readability on up to the first chunk
                        const sliceSize = SBFile.MAX_SBFILE_CHUNK_SIZE;
                        const fileSlice = fileObject.slice(0, sliceSize);
                
                        await new Promise((resolve) => setTimeout(resolve, 20)); // Release pressure on the browser
                        const buffer = await readFileAsArrayBuffer(fileSlice);
                        if (!buffer) return null;
                        // ToDo: can probably assign the file parameter here
                        return { file: fileObject, buffer: buffer };
                    } catch (error) {
                        console.warn(`Error processing file: ${file.name}, ${error}`);
                        return null;
                    }
                }
                
                // async function findFirstResolved(fileList: Array<File | FileSystemEntry | FileSystemFileEntry>): Promise<{ file: File, buffer: ArrayBuffer } | null> {
                    async function findFirstResolved(fileList: Array<BrowserFile>): Promise<{ file: File, buffer: ArrayBuffer } | null> {
                    for (let index = 0; index < fileList.length; index++) {
                        let result = await FP(fileList[index]);
                        if (result !== null) return result;
                    }
                    if (DBG0) {
                        console.warn("findFirstResolved(): found nothing usable from this fileList")
                        console.log(fileList)
                    }
                    return null;
                }
                
                let listOfFilePromises: Array<Promise<void>> = [];
                this.#currentFileList.forEach((value, key) => {
                    if ((value.fileContentCandidates) && (!value.hash /* .uniqueShardId */)) { // 20240320
                        // listOfFilePromises.push(value);
                        listOfFilePromises.push(
                            new Promise<void>(async (resolve) => {
                                if (!value.fileContentCandidates) throw new Error("Should not happen (L832)");
                                findFirstResolved(value.fileContentCandidates)
                                    .then(async (result: { file: File, buffer: ArrayBuffer } | null) => {
                                        if (DEBUG3) console.log(`got response for ${value.name}`)
                                        if (!result) {
                                            if (DBG2) console.log(`... contents are empty for item ${key} (probably a directory)`)
                                            // value.uniqueShardId = null;  // actually no, we'll leave it as undefined
                                        } else {
                                            // 20240320 - we can no longer piggyback on shard identifiers
                                            // TODO: multi-chunk hashing
                                            const hash = arrayBufferToBase62(await globalThis.crypto.subtle.digest('SHA-256', result.buffer)).slice(0, 12);
                                            value.hash = hash; // 20240320

                                            // const { idBinary } = await crypto.sbCrypto.generateIdKey(result!)
                                            // const id32 = arrayBufferToBase62(idBinary);
                                            // let alreadyThere = BrowserFileHelper.globalBufferMap.get(id32);
                                            let alreadyThere = StorageApi.getData(ChannelApi.knownShards.get(hash));
                                            if (alreadyThere) {
                                                if (DBG2) console.log(`... duplicate file found for ${key}`)
                                                // TODO: for multi-chunk files, we need to dedup on a chunk level, not file
                                                result.buffer = alreadyThere; // memory conservation
                                            } else if (BrowserFileHelper.knownBuffers.get(hash)) { // 20240320
                                                if (DBG2) console.log(`... duplicate file found found in knownBuffers for ${key}`)
                                                result.buffer = BrowserFileHelper.knownBuffers.get(hash)!; // memory conservation

                                            } else {
                                                // BrowserFileHelper.globalBufferMap.set(id32, result);
                                                // this is the only spot where the contents of a file are actually added to our known buffers
                                                if (DBG2) console.log(SEP, "Adding new contents of a file to knownBuffers:", value, SEP, result, SEP)
                                                BrowserFileHelper.knownBuffers.set(hash, result.buffer); // 20240320
                                            }
                                            if (value.size === undefined) {
                                                if (result.file && result.file.size !== undefined)
                                                    value.size = result.file.size;
                                                else
                                                    value.size = result.buffer.byteLength;
                                                // todo: check consistency of size with respect to max chunk size
                                                if (DBG2) console.log(`... setting size for ${key} to ${value.size}`)
                                            } else if (value.size !== result.buffer.byteLength) {
                                                if (DBG0) console.log(`WARNING: file ${value.name} has size ${value.size} but contents are ${result.buffer.byteLength} bytes (future multi-handle)`)
                                                // resolve(); // can't resolve here or the browseFile value won't forward
                                            }
                                            // value.uniqueShardId = id32; // 20240320
                                            value.browserFile = result.file;
                                            if (DBG2) console.log(`... found contents for ${key} (first ${result.buffer.byteLength} bytes, file hash '${hash}')`)
                                        }
                                        resolve();
                                    })
                                    .catch((error: any) => {
                                        if (DBG2) console.log(`couldn't read anything for ${key}`, error);
                                        // value.uniqueShardId = null;
                                        resolve();
                                    });
                            })
                        );
                    } else { if (DBG0) console.log(`skipping ${value.name} (item ${key})`) }
                });

                if (DBG0) console.log("... kicked off all file promises")

                await Promise.all(listOfFilePromises).then((_results) => {
                    // let's see what's in array buffers:
                    console.log("-------DONE adding to globalBufferMap ---------")
                    console.log(BrowserFileHelper.knownBuffers /* globalBufferMap */) // 20240320
                });

                // this now updates the table and the UI
                this.#currentFileList.forEach((value) => {
                    if (value.name) {
                        let path = "/";
                        if (value.SBfullName) {
                            if (!value.fullPath) throw new Error("Should not happen (L886)");
                            path = ("/" + value.SBfullName).substring(0, value.fullPath.lastIndexOf('/') + 1);
                        } else if (value.webkitRelativePath) {
                            path = ("/" + value.webkitRelativePath).substring(0, value.webkitRelativePath.lastIndexOf('/') + 1);
                        } else if (value.fullPath) {
                            path = value.fullPath.substring(0, value.fullPath.lastIndexOf('/') + 1);
                        } else if (nameToFullPath.has(value.name)) {
                            path = nameToFullPath.get(value.name)!.substring(0, nameToFullPath.get(value.name)!.lastIndexOf('/') + 1);
                        } else {
                            if (DBG2) {
                                console.log(`... no (further) path info for '${value.name}'`);
                                console.log(value);
                            }
                        }
                        // make sure last character is "/"
                        path = path.endsWith("/") ? path : path.concat("/");
                        if (DBG2) console.log(`... path for '${value.name}' is '${path}'`);
                        if (value.isDirectory === true) { value.type = "directory"; value.size = 0; }

                        let finalFullName = path + value.name;

                        let metaDataString = "";
                        let lastModifiedString = "";
                        if (value.lastModified) {
                            lastModifiedString = (new Date(value.lastModified)).toLocaleString();
                            metaDataString += ` [${lastModifiedString}]`;
                        }
                        if (value.size) {
                            metaDataString += ` [${value.size} bytes]`;
                        }
                        // if (value.uniqueShardId) {
                        //     metaDataString += ` [${value.uniqueShardId.substr(0, 12)}]`;
                        // }
                        if (value.hash) { // 20220320
                            metaDataString += ` [${value.hash}]`;
                        } else {
                            console.warn("[afterOperation] No hash? (L923)");
                        }
                        finalFullName += metaDataString;

                        // let row: SBFile = {
                        //     _SBFSVersion: '2024-02-01-0002',
                        //     name: value.name,
                        //     size: value.size,
                        //     type: value.type,
                        //     lastModified: lastModifiedString,
                        //     // hash: value.uniqueShardId?.substr(0, 12), // 20240320
                        //     hash: value.hash,
                        //     // these are extra / hidden:
                        //     path: path,
                        //     // uniqueShardId: value.uniqueShardId, // 20240320
                        //     fullName: finalFullName,
                        //     metaDataString: metaDataString,
                        //     SBfullName: value.SBfullName
                        // };

                        // let row = new SBFile({
                        //     name: value.name,
                        //     size: value.size,
                        //     type: value.type,
                        //     lastModified: lastModifiedString,
                        //     hash: value.hash,
                        //     path: path,
                        //     fullName: finalFullName,
                        //     metaDataString: metaDataString,
                        //     SBfullName: value.SBfullName    
                        // })

                        // // create new SBFile from ALL the properties in value:
                        // let row = new SBFile(getProperties(value, propertyList));

                        // with post-typescript clean up, this is now the same object;
                        // mapping to a 'row' view of things is now done in UI code 
                        // todo: clean up and just work with 'value'
                        const row = value
                        row.lastModified = lastModifiedString;
                        row.path = path;
                        row.fullName = finalFullName;
                        row.metaDataString = metaDataString;

                        let currentRow = this.finalFileList.get(finalFullName);
                        if (!currentRow) {
                            this.finalFileList.set(finalFullName, row);
                        } else {
                            // just a handful of things worth overriding:
                            if (DBG0) console.log(`... overriding some values for ${finalFullName} (this is rare)`)
                            if (currentRow!.size === undefined) currentRow!.size = row.size;
                            if (currentRow!.type === undefined) currentRow!.type = row.type;
                            if (currentRow!.lastModified === undefined) currentRow!.lastModified = row.lastModified;
                            // if (currentRow!.uniqueShardId === undefined) currentRow!.uniqueShardId = row.uniqueShardId;
                            if (currentRow!.hash === undefined) currentRow!.hash = row.hash; // 20240320
                        }

                        if (DBG2) { console.log(`File ${value.name} has info`); console.log(row); }
                    }
                });

                console.log("-------DONE building finalFileList ---------")
                console.log(this.finalFileList)

                // final coalescing; we review the finalFileList, and remove
                // directories, which includes everything that we were unable to
                // read the contents of
                if (SKIP_DIR) {
                    let reverseBufferMap: Map<string, Map<string, any>> = new Map(
                        Array.from(BrowserFileHelper.knownBuffers /* globalBufferMap */.keys()).map((key) => [key, new Map()]) // 20240320
                    );
                    for (const key of this.finalFileList.keys()) {
                        let entry = this.finalFileList.get(key)!;
                        if ((entry!.type === "directory") || (/* entry.uniqueShardId */ entry.hash === undefined)) { // 20240320
                            if (DBG2) console.log(`... removing ${key} from final list (directory)`)
                            this.finalFileList.delete(key);
                        } else {
                            const uniqueShortName = entry.name! + entry.metaDataString!;
                            if (entry.path !== "/") {
                                const mapEntry = reverseBufferMap.get(entry.hash /* .uniqueShardId */)!.get(uniqueShortName); // 20240320
                                if (mapEntry) {
                                    // we have a duplicate
                                    if (mapEntry.path.length > entry.path!.length) {
                                        // we're the shorter one, so we remove ourselves
                                        this.finalFileList.delete(key);
                                    } else {
                                        // we're the longer one, so we remove the old guy
                                        this.finalFileList.delete(mapEntry.fullName);
                                        reverseBufferMap.get(entry.hash /* .uniqueShardId */)!.set(uniqueShortName, entry); // 20240320
                                    }
                                } else {
                                    // otherwise we leave ourselves in
                                    reverseBufferMap.get(entry.hash /* uniqueShardId */)!.set(uniqueShortName, entry); // 20240320
                                }

                            }
                        }
                    }

                    if (DBG0) console.log(reverseBufferMap)

                    // after that first pass, we can now see whether short names are unique
                    for (const key of this.finalFileList.keys()) {
                        let entry = this.finalFileList.get(key)!;
                        const uniqueShortName = entry.name! + entry.metaDataString;
                        if (entry.path === "/") {
                            if (!entry.hash)
                                throw new Error("Internal Error (L930)"); // 20240320
                            const x = reverseBufferMap.get(entry.hash /* uniqueShardId! */)
                            if (x) {
                                const mapEntry = x.get(uniqueShortName); // 20240320
                                if (mapEntry) {
                                    // we have a duplicate, and delete ourselves
                                    if (DBG2) console.log(`... removing ${key} from final list (duplicate short name)`)
                                    this.finalFileList.delete(key);
                                } else {
                                    // otherwise we leave ourselves in
                                    if (DBG2) console.log(`... leaving ${key} in final list (unique short name)`)
                                }
                            } else console.warn("Internal Warning (L1042)"); // large file reverse buffer situation(s)
                        }
                    }

                }

                // finally we check if mime type is missing, and if so, try to figure it out
                for (const key of this.finalFileList.keys()) {
                    let entry = this.finalFileList.get(key)!;
                    // update: sometimes the browser does the wrong thing (!) notably with svg
                    let mimeType = getMimeType(entry.name);
                    if (mimeType && (entry.type !== mimeType)) {
                        console.warn(`Mime type mismatch for ${key}: ${entry.type} vs ${mimeType} (we will overrule)`);
                        entry.type = mimeType;
                    }

                    // if (!entry.type) {
                    //     if (DBG2) console.log(`... trying to figure out mime type for ${key}`)
                    //     if (!entry.name)
                    //         throw new Error("Internal Error (L1018)"); // 20240320
                    //     let mimeType = getMimeType(entry.name); // 20240320
                    //     if (mimeType) {
                    //         entry.type = mimeType;
                    //     } else {
                    //         entry.type = "";
                    //     }
                    // }
                }

                // "export" as a sorted array to our table
                // let tableContents = Array.from(finalFileList).sort((a, b) => a[0].localeCompare(b[0]));
                // let tableContents = Array.from(finalFileList.values()).sort((a, b) => a.toString().localeCompare(b.toString()));
                let tableContents = Array.from(this.finalFileList.values()).sort((a, b) =>
                    a.path!.localeCompare(b.path!) || a.name!.localeCompare(b.name!)
                );

                if (DBG0) {
                    console.log("Table contents:")
                    console.log(tableContents);
                }

                console.log("-------DONE with all file promises (clearing state) ---------")

                // some cleanup for the next round
                this.#itemNumber = createCounter();
                this.#fileItemNumber = createCounter();
                this.#globalFileMap = new Map();
                this.#currentFileList = new Map();
                // we do NOT clear the globalBufferMap

                this.currentFileList = tableContents; // tracks latest
                if (callback) {
                    callback(tableContents);
                } else {
                    console.info("Note: no callback, so no update on tableContents:")
                    console.log(tableContents);
                }

            })(); // async
        }, 50);
    }


    //#region UI HOOKS ****************************************************************************************************
    //
    // Here's roughly how you would hook up from an HTML page to this code.
    // It will handle clicks and drops, both "file" and "directory" zones.
    //
    // "handleEvent()" handles all such events. It will call
    // scanItemList() and scanFileList() on all the data, then
    // the above "afteOperation()"


    // }

    handleFileDrop(event: DragEvent, callback: ((table: Array<SBFile>) => void)) {
        event.preventDefault();
        return this.handleEvent(event, callback, "[file drop]");
    }

    handleDirectoryDrop(event: DragEvent, callback: ((table: Array<SBFile>) => void)) {
        event.preventDefault();
        return this.handleEvent(event, callback, "[directory drop]");
    }

    handleFileClick(event: Event, callback: ((table: Array<SBFile>) => void)) {
        event.preventDefault();
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = '*/*';
        fileInput.addEventListener('change', (event) => {
            this.handleEvent(event, callback, "[file click]");
        });
        fileInput.click();
    }

    handleDirectoryClick(event: Event, callback: ((table: Array<SBFile>) => void)) {
        event.preventDefault();
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.webkitdirectory = true;
        fileInput.accept = '*/*';
        fileInput.addEventListener('change', (event) => {
            this.handleEvent(event, callback, "[directory click]")
        });
        fileInput.click();
    }

    // this gets all events, eg both input type=file and drag and drop;
    // 'context' is a debug string of where event is coming from. the callback
    // is called with the current file list (as an array of SBFile objects)
    private async handleEvent(event: Event | DragEvent, callback: ((table: Array<SBFile>) => void), _context: any) {
        let files, items;
        if ((event as DragEvent).dataTransfer) {
            files = (event as DragEvent).dataTransfer!.files;
            items = (event as DragEvent).dataTransfer!.items;
        } else if (event.target) {
            if ((event.target as any as CustomEventTarget).files)
                files = (event.target as any as CustomEventTarget).files;
            if ((event.target as any as CustomEventTarget).items)
                items = (event.target as any as CustomEventTarget).items;
        } else {
            console.log("Unknown event type (should not happen):");
            console.log(event);
            return;
        }
        if (DEBUG3) {
            console.log("Received items (DataTransferItemList):")
            console.log(items);
            console.log("Received files:")
            console.log(files);
        }
        this.scanItemList(items);
        this.scanFileList(files);
        this.afterOperation(callback);
    }

    clearNewSet = () => { // ToDo: this should be moved
        const uploadButton = document.getElementById("uploadNewSetButton");
        if (uploadButton) uploadButton.removeAttribute("disabled");
        console.info("******** cleared current file list ********")
        if (this.callbacks.processNewTable)
            this.callbacks.processNewTable([]);
        const newSetButton = document.getElementById('uploadNewSetButton');
        if (newSetButton) newSetButton.style.display = 'none';
        this.currentFileList = [];
        this.finalFileList.clear();
        // hm actually knownBuffers should naturally be cleared when done, so,
        // we should probably instead confirm that it's empty
        BrowserFileHelper.knownBuffers.clear();
    }
}

if (DBG0) console.warn("==== SBFileHelper.ts loaded ====")

// // archived, was used to test to read files. might not be updated with latest SBFile refactors (big files etc)
// // internal test/debug function, used to verify files can be accessed
// function testToRead(file: File | FileSystemEntry | FileSystemFileEntry, location: string) {
//     try {
//         const reader = new FileReader();
//         reader.readAsText(file as File);
//         reader.onload = (e) => {
//             if (DBG2) {
//                 console.log("========================================================")
//                 console.log(`[${location}] was able to readAsText():`);
//                 console.log(file)
//             }
//             if (e.target === null) {
//                 if (DBG0) console.log('**** e.target is null ****');
//             } else {
//                 if (DBG2) console.log(`[${location}] (direct) successfully read file ${file.name}`);
//             }
//         }
//     } catch (error) {
//         try {
//             if ((file as any).file) {
//                 let originalFile = file;
//                 (file as any).file((file: File) => {
//                     if (DBG2) {
//                         console.log("========================================================")
//                         console.log(`[${location}] was able to get a file() for object:`);
//                         console.log(originalFile)
//                         console.log(file)
//                     }
//                     const reader = new FileReader();
//                     reader.readAsText(file as File);
//                     reader.onload = (e) => {
//                         if (e.target === null) {
//                             console.log('**** e.target is null ****');
//                         } else {
//                             if (DBG2) console.log(`[${location}] (using file()) successfully read file ${file.name}`);
//                             // console.log(e.target.result);
//                         }
//                     }
//                 });
//             }
//         } catch (error) {
//             console.log(`[${location}] error reading file ${file.name}`);
//         }
//     }
// }


// /* below is an older version of FP(); it had been tested on lots of different browser/platform
//    combinations, so we are retaining it until we've tested enough to feel the same way about the new one */
// async function FP(file: File | FileSystemEntry | FileSystemFileEntry): Promise<ArrayBuffer | null> {
//     return new Promise(async (resolve) => {
//         console.log(SEP)
//         console.log("Will test reading file:")
//         console.log(file);
//         console.log("Is a file: " + (file as FileSystemEntry).isFile);
//         console.log(SEP)
//         try {
//             const reader = new FileReader();
//             reader.onload = (e) => {
//                 if ((e.target === null) || (e.target.result === null)) {
//                     if (DBG2)
//                         console.log(`+++++++ got a null back for '${file.name}' (??)`);
//                     resolve(null)
//                 } else if (typeof e.target.result === 'string') {
//                     if (DBG2)
//                         console.log(`+++++++ got a 'string' back for '${file.name}' (??)`);
//                     resolve(null)
//                 } else {
//                     if (DBG2) {
//                         console.log(`+++++++ read file '${file.name}'`);
//                         console.log(e.target.result);
//                     }
//                     resolve(e.target.result)
//                 }
//             }
//             reader.onerror = (event) => {
//                 if (DBG2) { console.log(`Could not read: ${file.name}`); console.log(event); }
//                 resolve(null);
//             }
//             // we try to release pressure on the browser
//             await new Promise((resolve) => setTimeout(resolve, 20));
//             reader.readAsArrayBuffer(file as File);
//         } catch (error) {
//             try {
//                 if (DBG2) console.log(`+++++++ got error on '${file.name}', will try as FileSystemFileEntry`);
//                 if ((file as any).file) {
//                     (file as any).file(async (file: File) => {
//                         const reader = new FileReader();
//                         reader.onload = (e) => {
//                             if ((e.target === null) || (e.target.result === null)) resolve(null)
//                             else if (typeof e.target.result === 'string') resolve(null)
//                             else resolve(e.target.result)
//                         }
//                         reader.onerror = () => { resolve(null); }
//                         // we try to release pressure on the browser
//                         await new Promise((resolve) => setTimeout(resolve, 20));
//                         reader.readAsArrayBuffer(file as File);
//                     });
//                 } else {
//                     if (DBG2) console.log(`... cannot treat as file: ${file.name}`);
//                 }
//             } catch (error) {
//                 if (DBG2) console.log(`Could not read: ${file.name}`);
//             }
//             resolve(null);
//         }
//     });
// }