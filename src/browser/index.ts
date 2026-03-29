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
