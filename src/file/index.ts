// (c) 2023 384 (tm)

import { SBFileSystem } from './SBFileSystem';
import { SBFileSystem2 } from './SBFileSystem2';

// list of low-risk common file types that can be loaded directly (without subdomain)
const simpleAndSafeFileTypes: Set<string> = new Set([
    'application/gzip',   // GZip Compressed Archive
    'application/json',   // JSON format
    'application/octet-stream',   // Any kind of binary data
    // PDF is perhaps debatable, but it's a very common format and safe in a modern browser
    'application/pdf',   // Adobe Portable Document Format (PDF)
    'application/rtf',   // Rich Text Format (RTF)
    'audio/aac',   // AAC audio
    'audio/mpeg',   // MP3 audio
    'audio/mp4',   // MP4 audio
    'audio/ogg',   // OGG audio
    'audio/opus',   // Opus audio
    'audio/wav',   // Waveform Audio Format
    'audio/webm',   // WEBM audio
    'font/woff',   // Web Open Font Format (WOFF)
    'font/woff2',   // Web Open Font Format (WOFF)
    'image/avif',   // AVIF image
    'image/bmp',   // Windows OS/2 Bitmap Graphics
    'image/gif',   // Graphics Interchange Format (GIF)
    'image/jpeg',   // JPEG images
    'image/png',   // Portable Network Graphics
    'image/svg+xml',   // Scalable Vector Graphics (SVG)
    'image/tiff',   // Tagged Image File Format (TIFF)
    'image/webp',   // WEBP image
    'text/csv',   // Comma-separated values (CSV)
    'text/plain',   // Text, (generally ASCII or ISO 8859-n)
    'text/xml',   // XML
    'video/mp2t',   // MPEG transport stream
    'video/mp4',   // MP4 video
    'video/mpeg',   // MPEG Video
    'video/ogg',   // OGG video
]);

/** @public */
export const file = {
    SBFileSystem: SBFileSystem,
    SBFileSystem2: SBFileSystem2,
    safe: simpleAndSafeFileTypes
};
