/**
 * Pure JavaScript QR Code Decoder
 * Detects and decodes QR codes from image data
 */

const QRDecoder = (() => {
    // Galois Field for Reed-Solomon
    const GF_EXP = new Array(512);
    const GF_LOG = new Array(256);

    (function initGF() {
        let x = 1;
        for (let i = 0; i < 255; i++) {
            GF_EXP[i] = x;
            GF_LOG[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11d;
        }
        for (let i = 255; i < 512; i++) {
            GF_EXP[i] = GF_EXP[i - 255];
        }
    })();

    function gfMul(x, y) {
        if (x === 0 || y === 0) return 0;
        return GF_EXP[(GF_LOG[x] + GF_LOG[y]) % 255];
    }

    function gfDiv(x, y) {
        if (y === 0) throw new Error('Division by zero');
        if (x === 0) return 0;
        return GF_EXP[(GF_LOG[x] - GF_LOG[y] + 255) % 255];
    }

    function gfPolyEval(p, x) {
        let result = 0;
        for (let i = 0; i < p.length; i++) {
            result = gfMul(result, x) ^ p[i];
        }
        return result;
    }

    // Binarize image using adaptive threshold
    function binarize(imageData, width, height) {
        const gray = new Uint8Array(width * height);
        const binary = new Uint8Array(width * height);

        // Convert to grayscale
        for (let i = 0; i < width * height; i++) {
            const r = imageData[i * 4];
            const g = imageData[i * 4 + 1];
            const b = imageData[i * 4 + 2];
            gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }

        // Adaptive threshold with integral image
        const blockSize = Math.max(3, Math.floor(Math.min(width, height) / 8) | 1);
        const C = 7;

        // Compute integral image
        const integral = new Float64Array(width * height);
        for (let y = 0; y < height; y++) {
            let rowSum = 0;
            for (let x = 0; x < width; x++) {
                rowSum += gray[y * width + x];
                integral[y * width + x] = rowSum + (y > 0 ? integral[(y - 1) * width + x] : 0);
            }
        }

        const half = Math.floor(blockSize / 2);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const x1 = Math.max(0, x - half);
                const y1 = Math.max(0, y - half);
                const x2 = Math.min(width - 1, x + half);
                const y2 = Math.min(height - 1, y + half);

                const count = (x2 - x1 + 1) * (y2 - y1 + 1);
                let sum = integral[y2 * width + x2];
                if (x1 > 0) sum -= integral[y2 * width + (x1 - 1)];
                if (y1 > 0) sum -= integral[(y1 - 1) * width + x2];
                if (x1 > 0 && y1 > 0) sum += integral[(y1 - 1) * width + (x1 - 1)];

                const threshold = sum / count - C;
                binary[y * width + x] = gray[y * width + x] > threshold ? 0 : 1;
            }
        }

        return binary;
    }

    // Find finder patterns
    function findFinderPatterns(binary, width, height) {
        const patterns = [];

        function checkRatio(counts) {
            const total = counts.reduce((a, b) => a + b, 0);
            if (total < 7) return false;

            const unit = total / 7;
            const tolerance = unit * 0.5;

            return Math.abs(counts[0] - unit) < tolerance &&
                Math.abs(counts[1] - unit) < tolerance &&
                Math.abs(counts[2] - 3 * unit) < tolerance * 3 &&
                Math.abs(counts[3] - unit) < tolerance &&
                Math.abs(counts[4] - unit) < tolerance;
        }

        function checkVertical(cx, cy, width, height, binary) {
            const counts = [0, 0, 0, 0, 0];
            let y = cy;

            // Go up
            while (y >= 0 && binary[y * width + cx] === 1) { counts[2]++; y--; }
            while (y >= 0 && binary[y * width + cx] === 0) { counts[1]++; y--; }
            while (y >= 0 && binary[y * width + cx] === 1) { counts[0]++; y--; }

            // Go down
            y = cy + 1;
            while (y < height && binary[y * width + cx] === 1) { counts[2]++; y++; }
            while (y < height && binary[y * width + cx] === 0) { counts[3]++; y++; }
            while (y < height && binary[y * width + cx] === 1) { counts[4]++; y++; }

            return checkRatio(counts);
        }

        for (let y = 0; y < height; y++) {
            const counts = [0, 0, 0, 0, 0];
            let currentState = 0;

            for (let x = 0; x < width; x++) {
                const pixel = binary[y * width + x];

                if (pixel === 1) { // Black
                    if (currentState % 2 === 1) currentState++;
                    counts[currentState]++;
                } else { // White
                    if (currentState % 2 === 0) {
                        if (currentState === 4) {
                            if (checkRatio(counts)) {
                                const total = counts.reduce((a, b) => a + b, 0);
                                const cx = x - total / 2;

                                if (checkVertical(Math.floor(cx), y, width, height, binary)) {
                                    // Found a finder pattern candidate
                                    const existingIdx = patterns.findIndex(p =>
                                        Math.abs(p.x - cx) < total && Math.abs(p.y - y) < total
                                    );

                                    if (existingIdx === -1) {
                                        patterns.push({ x: cx, y, size: total / 7 });
                                    }
                                }
                            }
                            counts[0] = counts[2];
                            counts[1] = counts[3];
                            counts[2] = counts[4];
                            counts[3] = 1;
                            counts[4] = 0;
                            currentState = 3;
                        } else {
                            currentState++;
                            counts[currentState]++;
                        }
                    } else {
                        counts[currentState]++;
                    }
                }
            }
        }

        return patterns;
    }

    // Order finder patterns: top-left, top-right, bottom-left
    function orderFinderPatterns(patterns) {
        if (patterns.length < 3) return null;

        // Find the three closest patterns
        let best = null;
        let bestDist = Infinity;

        for (let i = 0; i < patterns.length; i++) {
            for (let j = i + 1; j < patterns.length; j++) {
                for (let k = j + 1; k < patterns.length; k++) {
                    const pts = [patterns[i], patterns[j], patterns[k]];
                    const dists = [
                        Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
                        Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y),
                        Math.hypot(pts[0].x - pts[2].x, pts[0].y - pts[2].y)
                    ];
                    const maxDist = Math.max(...dists);
                    const variance = dists.reduce((s, d) => s + (d - maxDist) ** 2, 0);

                    if (maxDist < bestDist) {
                        bestDist = maxDist;
                        best = pts;
                    }
                }
            }
        }

        if (!best) return null;

        // Sort by distance to find top-left (corner opposite to hypotenuse)
        const [a, b, c] = best;
        const ab = Math.hypot(a.x - b.x, a.y - b.y);
        const bc = Math.hypot(b.x - c.x, b.y - c.y);
        const ac = Math.hypot(a.x - c.x, a.y - c.y);

        let topLeft, topRight, bottomLeft;

        if (ab > bc && ab > ac) {
            topLeft = c;
            [topRight, bottomLeft] = a.x < b.x ? [b, a] : [a, b];
        } else if (bc > ab && bc > ac) {
            topLeft = a;
            [topRight, bottomLeft] = b.x < c.x ? [c, b] : [b, c];
        } else {
            topLeft = b;
            [topRight, bottomLeft] = a.x < c.x ? [c, a] : [a, c];
        }

        // Make sure bottomLeft is below topLeft
        if (bottomLeft.y < topLeft.y) {
            [topRight, bottomLeft] = [bottomLeft, topRight];
        }

        return { topLeft, topRight, bottomLeft };
    }

    // Sample the QR code matrix
    function sampleGrid(binary, width, patterns, version) {
        const size = version * 4 + 17;
        const { topLeft, topRight, bottomLeft } = patterns;

        // Estimate bottom-right
        const bottomRight = {
            x: topRight.x + bottomLeft.x - topLeft.x,
            y: topRight.y + bottomLeft.y - topLeft.y
        };

        // Create perspective transform
        const moduleSize = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) / (size - 7);

        const matrix = [];
        for (let r = 0; r < size; r++) {
            matrix.push(new Array(size).fill(0));
        }

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                // Bilinear interpolation
                const tx = c / (size - 1);
                const ty = r / (size - 1);

                const top = {
                    x: topLeft.x + tx * (topRight.x - topLeft.x),
                    y: topLeft.y + tx * (topRight.y - topLeft.y)
                };
                const bottom = {
                    x: bottomLeft.x + tx * (bottomRight.x - bottomLeft.x),
                    y: bottomLeft.y + tx * (bottomRight.y - bottomLeft.y)
                };

                const px = Math.floor(top.x + ty * (bottom.x - top.x));
                const py = Math.floor(top.y + ty * (bottom.y - top.y));

                if (px >= 0 && px < width && py >= 0 && py < binary.length / width) {
                    matrix[r][c] = binary[py * width + px];
                }
            }
        }

        return matrix;
    }

    // Read format information
    function readFormatInfo(matrix, size) {
        let format1 = 0;
        let format2 = 0;

        // Read from top-left corner
        for (let i = 0; i <= 5; i++) {
            format1 = (format1 << 1) | matrix[8][i];
        }
        format1 = (format1 << 1) | matrix[8][7];
        format1 = (format1 << 1) | matrix[8][8];
        format1 = (format1 << 1) | matrix[7][8];
        for (let i = 5; i >= 0; i--) {
            format1 = (format1 << 1) | matrix[i][8];
        }

        // XOR with mask pattern
        format1 ^= 0x5412;

        const ecLevelBits = (format1 >> 13) & 0x3;
        const maskPattern = (format1 >> 10) & 0x7;

        const ecLevels = ['M', 'L', 'H', 'Q'];

        return {
            ecLevel: ecLevels[ecLevelBits],
            maskPattern
        };
    }

    // Apply mask pattern
    function applyMask(matrix, size, mask) {
        const maskFunctions = [
            (r, c) => (r + c) % 2 === 0,
            (r, c) => r % 2 === 0,
            (r, c) => c % 3 === 0,
            (r, c) => (r + c) % 3 === 0,
            (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
            (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
            (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
            (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
        ];

        const fn = maskFunctions[mask];
        const result = matrix.map(row => [...row]);

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (!isReserved(r, c, size) && fn(r, c)) {
                    result[r][c] ^= 1;
                }
            }
        }

        return result;
    }

    function isReserved(r, c, size) {
        // Finder patterns + separators
        if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) return true;
        // Timing patterns
        if (r === 6 || c === 6) return true;
        return false;
    }

    // Extract data bits
    function extractData(matrix, size) {
        const bits = [];
        let upward = true;

        for (let col = size - 1; col >= 0; col -= 2) {
            if (col === 6) col = 5;

            for (let row = 0; row < size; row++) {
                const actualRow = upward ? size - 1 - row : row;

                for (let c = 0; c < 2; c++) {
                    const actualCol = col - c;
                    if (!isReserved(actualRow, actualCol, size)) {
                        bits.push(matrix[actualRow][actualCol]);
                    }
                }
            }
            upward = !upward;
        }

        return bits;
    }

    // Decode the data
    function decodeData(bits) {
        let pos = 0;

        function readBits(n) {
            let val = 0;
            for (let i = 0; i < n; i++) {
                val = (val << 1) | (bits[pos++] || 0);
            }
            return val;
        }

        const mode = readBits(4);

        if (mode === 0) return ''; // Terminator

        let result = '';

        if (mode === 4) { // Byte mode
            const count = readBits(8);
            for (let i = 0; i < count; i++) {
                result += String.fromCharCode(readBits(8));
            }
        } else if (mode === 2) { // Alphanumeric mode
            const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
            const count = readBits(9);
            for (let i = 0; i < Math.floor(count / 2); i++) {
                const val = readBits(11);
                result += chars[Math.floor(val / 45)] + chars[val % 45];
            }
            if (count % 2 === 1) {
                result += chars[readBits(6)];
            }
        } else if (mode === 1) { // Numeric mode
            const count = readBits(10);
            for (let i = 0; i < Math.floor(count / 3); i++) {
                const val = readBits(10);
                result += String(val).padStart(3, '0');
            }
            const rem = count % 3;
            if (rem === 2) {
                result += String(readBits(7)).padStart(2, '0');
            } else if (rem === 1) {
                result += String(readBits(4));
            }
        }

        return result;
    }

    function decode(imageData, width, height) {
        try {
            const binary = binarize(imageData, width, height);
            const patterns = findFinderPatterns(binary, width, height);

            if (patterns.length < 3) return null;

            const ordered = orderFinderPatterns(patterns);
            if (!ordered) return null;

            // Estimate version from pattern distance
            const dist = Math.hypot(
                ordered.topRight.x - ordered.topLeft.x,
                ordered.topRight.y - ordered.topLeft.y
            );
            const moduleSize = dist / 14; // Distance between finder pattern centers
            const estimatedSize = Math.round(dist / moduleSize + 7);
            const version = Math.round((estimatedSize - 17) / 4);

            if (version < 1 || version > 10) return null;

            const matrix = sampleGrid(binary, width, ordered, version);
            const size = version * 4 + 17;

            const formatInfo = readFormatInfo(matrix, size);
            const unmasked = applyMask(matrix, size, formatInfo.maskPattern);
            const bits = extractData(unmasked, size);
            const data = decodeData(bits);

            return data || null;
        } catch (e) {
            console.error('QR decode error:', e);
            return null;
        }
    }

    return { decode };
})();
