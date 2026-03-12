// (c) 2023 384 (tm)

import { BrowserFileHelper, getMimeType } from './BrowserFileHelper';
import { readJpegHeader } from './images';
import { BrowserFileTable } from './BrowserFileTable';
import { SBServiceWorker } from '../boot/serviceWorker';
import { browserPreviewFile } from './browserPreviewFile';
import { clearBrowserState } from './utils';


/** @public */
export const browser = {
    BrowserFileHelper: BrowserFileHelper,
    BrowserFileTable: BrowserFileTable,
    serviceWorker: SBServiceWorker,
    fileViewer: browserPreviewFile,
    images: {
        readJpegHeader: readJpegHeader
    },
    getMimeType: getMimeType,
    clearBrowserState: clearBrowserState,
};
