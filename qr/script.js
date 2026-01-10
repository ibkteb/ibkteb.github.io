const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const resultDiv = document.getElementById('result');
const cameraBtn = document.getElementById('cameraBtn');

let stream = null;
let scanning = false;
let lastResult = '';

// ===== Camera Toggle =====
cameraBtn.addEventListener('click', toggleCamera);

async function toggleCamera() {
    if (scanning) {
        stopCamera();
    } else {
        await startCamera();
    }
}

async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        video.srcObject = stream;
        await video.play();

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        cameraBtn.textContent = 'Stop Camera';
        cameraBtn.classList.add('active');
        scanning = true;

        scan();
    } catch (err) {
        console.error('Camera access error:', err);
        resultDiv.innerHTML = `<span style="color: #ff4757;">Error: ${err.message}</span>`;
    }
}

function stopCamera() {
    scanning = false;

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    video.srcObject = null;
    cameraBtn.textContent = 'Start Camera';
    cameraBtn.classList.remove('active');
}

function scan() {
    if (!scanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Use custom QR decoder
        const data = QRDecoder.decode(imageData.data, imageData.width, imageData.height);

        if (data && data !== lastResult) {
            lastResult = data;
            displayResult(data);
        }
    }

    requestAnimationFrame(scan);
}

function displayResult(data) {
    resultDiv.textContent = data;
    resultDiv.classList.remove('success');
    void resultDiv.offsetWidth; // Trigger reflow for animation
    resultDiv.classList.add('success');
}

// ===== Tab Switching =====
const tabs = document.querySelectorAll('.tab');
const sections = document.querySelectorAll('.section');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;

        // Update active tab
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update active section
        sections.forEach(s => s.classList.remove('active'));
        document.getElementById(`${targetTab}-section`).classList.add('active');

        // Stop camera when switching away from reader
        if (targetTab !== 'reader' && scanning) {
            stopCamera();
        }
    });
});

// ===== QR Code Generator (Real-time) =====
const qrText = document.getElementById('qrText');
const qrcodeDiv = document.getElementById('qrcode');
const downloadBtn = document.getElementById('downloadBtn');

let currentQRCanvas = null;
let debounceTimer = null;

// Generate on input with debounce
qrText.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(generateQRCode, 150);
});

function generateQRCode() {
    const text = qrText.value.trim();

    if (!text) {
        qrcodeDiv.innerHTML = '';
        downloadBtn.disabled = true;
        return;
    }

    try {
        // Clear previous QR code
        qrcodeDiv.innerHTML = '';

        // Generate QR code using custom encoder
        const qrData = QREncoder.generate(text, 'M');

        // Create canvas and render
        const qrCanvas = document.createElement('canvas');
        QREncoder.renderToCanvas(qrData, qrCanvas, { scale: 8, margin: 4 });

        qrcodeDiv.appendChild(qrCanvas);
        currentQRCanvas = qrCanvas;
        downloadBtn.disabled = false;
    } catch (error) {
        console.error(error);
        qrcodeDiv.innerHTML = `<span style="color: #ff4757;">Error: ${error.message}</span>`;
        downloadBtn.disabled = true;
    }
}

downloadBtn.addEventListener('click', () => {
    if (!currentQRCanvas) return;

    const link = document.createElement('a');
    link.download = 'qrcode.png';
    link.href = currentQRCanvas.toDataURL('image/png');
    link.click();
});
