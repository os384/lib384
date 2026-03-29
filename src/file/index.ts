/*
 * Copyright (C) 2019-2021 Magnusson Institute
 * Copyright (C) 2022-2026 384, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
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
