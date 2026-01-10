const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const resultDiv = document.getElementById('result');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');

let stream = null;
let scanning = false;
let lastResult = '';

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

        startBtn.disabled = true;
        stopBtn.disabled = false;
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
    startBtn.disabled = false;
    stopBtn.disabled = true;
}

function scan() {
    if (!scanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
        });

        if (code && code.data && code.data !== lastResult) {
            lastResult = code.data;
            displayResult(code.data);
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

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);

// Auto-start on page load (optional - uncomment if desired)
// startCamera();
