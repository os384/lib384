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
import { SBError } from 'src/common';

/** @public */
export async function browserPreviewFile(
    data: ArrayBuffer,
    mimeType: string,
    docElements: {
        mainDoc: Document,
        preview: HTMLElement,
        maxButton: HTMLElement,
        // ToDo: hm no 'minButton'?
    }
) {
    console.log('previewFile', data, mimeType, docElements)
    if (!data || !(data instanceof ArrayBuffer)) throw new Error("[browserPreviewFile] data not found or not an ArrayBuffer");

    // const IFRAME_SANDBOX_strict = 'allow-same-origin';
    const IFRAME_SANDBOX_weak = 'allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-top-navigation';

    if (!docElements || !docElements.mainDoc || !docElements.preview || !docElements.maxButton)
        throw new Error("previewFile: docElements not found or incomplete")

    const preview = docElements.preview // document.getElementById('preview');
    if (!preview) throw new Error("browserPreviewFile: preview element not found")
    preview.innerHTML = '';
    preview.style.minHeight = '100%';
    preview.style.display = 'flex';
    if (mimeType === 'text/html') {
        const iframe = docElements.mainDoc.createElement('iframe') // document.createElement('iframe');
        iframe.setAttribute('id', 'myIframe')
        iframe.setAttribute('sandbox', IFRAME_SANDBOX_weak);
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        preview.appendChild(iframe);

        docElements.maxButton.style.display = "";

        // Convert the data to a string
        const htmlContent = new TextDecoder().decode(data);
        // Inject the HTML content into the iframe
        if (!iframe.contentWindow) throw new SBError("previewFile: iframe.contentWindow not found")
        iframe.contentWindow.document.open();
        iframe.contentWindow.document.write(htmlContent);
        iframe.contentWindow.document.close();

    } else if (mimeType.startsWith('image/')) {
        preview.style.display = 'block';
        // Create a Blob with the data and the provided MIME type
        const fileBlob = new Blob([data], { type: mimeType });
        // Generate a URL from the Blob
        const fileURL = URL.createObjectURL(fileBlob);
        // Create an img element for images
        const img = docElements.mainDoc.createElement('img') // document.createElement('img');
        img.style.width = '100%';
        // img.style.height = '100%'; // We remove the height so the image is shown at the top of the container
        img.style.objectFit = 'contain'; // To preserve aspect ratio and fit the image inside the container
        img.src = fileURL;
        docElements.maxButton.style.display = "none";
        preview.appendChild(img);
    } else {
        preview.style.minHeight = '768px';
        // Inject the message into the iframe
        const message = 'This file might not show correctly or might be auto-downloaded.';
        const iframe = docElements.mainDoc.createElement('iframe') // document.createElement('iframe');
        if (!iframe) throw new Error("previewFile: iframe element not found")
        iframe.setAttribute('id', 'myIframe')
        // iframe.setAttribute('sandbox', IFRAME_SANDBOX_strict);
        iframe.style.width = '100%';
        // iframe.style.height = '500px'; // Adjust the height to your needs
        // iframe.style.height = '100%';
        preview.appendChild(iframe);
        if (!iframe.contentWindow) throw new Error("previewFile: iframe.contentWindow not found")
        iframe.contentWindow.document.open();
        iframe.contentWindow.document.write('<html><head></head><body><p>' + message + '</p></body></html>');
        iframe.contentWindow.document.close();

        // Create a Blob with the data and the provided MIME type
        const fileBlob = new Blob([data], { type: mimeType });

        // Generate a URL from the Blob
        const fileURL = URL.createObjectURL(fileBlob);

        // Wait for a short period before injecting the actual content
        setTimeout(() => {
            // Create an iframe to display other content types
            // const iframe = document.createElement('iframe');
            // iframe.style.width = '100%';
            // iframe.style.height = '500px'; // Adjust the height to your needs
            iframe.src = fileURL;
            // preview.appendChild(iframe);
            docElements.maxButton.style.display = "";

            // Release the Blob URL to free up memory (optional, can be done later)
            iframe.addEventListener('unload', () => {
                URL.revokeObjectURL(fileURL);
            });
        }
            , 200);
    }

}
