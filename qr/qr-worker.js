// QR Scanner Web Worker
// Runs jsQR in a separate thread for parallel processing

importScripts('jsQR.min.js');

self.onmessage = function (e) {
    const { imageData, width, height, frameId } = e.data;

    // Run jsQR
    const code = jsQR(imageData, width, height);

    // Send result back
    self.postMessage({
        frameId,
        found: !!code,
        data: code ? code.data : null
    });
};
