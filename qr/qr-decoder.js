/**
 * Pure JavaScript QR Code Decoder
 * Optimized for decoding clean, generated QR codes
 */

const QRDecoder = (() => {
    function binarize(imageData, width, height) {
        const binary = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const gray = 0.299 * imageData[i * 4] + 0.587 * imageData[i * 4 + 1] + 0.114 * imageData[i * 4 + 2];
            binary[i] = gray < 128 ? 1 : 0;
        }
        return binary;
    }

    // Find the center of a finder pattern by exploring from a seed point
    function refineCenter(binary, width, height, seedX, seedY) {
        // Find the center of the inner 3x3 black square
        // Start from seed and expand to find the bounds of the continuous black region

        let x = Math.floor(seedX);
        let y = Math.floor(seedY);

        // Make sure we're on black
        while (x > 0 && binary[y * width + x] === 0) x--;
        while (x < width && binary[y * width + x] === 0) x++;
        if (binary[y * width + x] === 0) return null;

        // Find horizontal extent of center black region
        let left = x, right = x;
        while (left > 0 && binary[y * width + left - 1] === 1) left--;
        while (right < width - 1 && binary[y * width + right + 1] === 1) right++;

        // Find center X
        const cx = (left + right) / 2;

        // Find vertical extent at center X
        let top = y, bottom = y;
        const cxi = Math.floor(cx);
        while (top > 0 && binary[(top - 1) * width + cxi] === 1) top--;
        while (bottom < height - 1 && binary[(bottom + 1) * width + cxi] === 1) bottom++;

        // Find center Y
        const cy = (top + bottom) / 2;

        // Estimate module size from the center black square (should be 3 modules)
        const sizeX = (right - left + 1) / 3;
        const sizeY = (bottom - top + 1) / 3;
        const moduleSize = (sizeX + sizeY) / 2;

        return { x: cx, y: cy, size: moduleSize };
    }

    function findFinderPatterns(binary, width, height) {
        const candidates = [];

        // Scan for 1:1:3:1:1 patterns
        for (let y = 0; y < height; y++) {
            let state = binary[y * width] === 1 ? 0 : -1;
            const counts = [0, 0, 0, 0, 0];

            for (let x = 0; x < width; x++) {
                const pixel = binary[y * width + x];
                const expected = state % 2;

                if (state === -1) {
                    if (pixel === 1) { state = 0; counts[0] = 1; }
                } else if (pixel === expected) {
                    counts[state]++;
                } else {
                    if (state === 4) {
                        if (checkRatio(counts)) {
                            const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
                            // Rough center X from the pattern
                            const roughX = x - counts[4] - counts[3] - counts[2] / 2;

                            // Refine the center
                            const refined = refineCenter(binary, width, height, roughX, y);
                            if (refined) {
                                candidates.push({
                                    x: refined.x,
                                    y: refined.y,
                                    size: refined.size,
                                    width: total
                                });
                            }
                        }
                        counts[0] = counts[2]; counts[1] = counts[3]; counts[2] = counts[4];
                        counts[3] = 1; counts[4] = 0; state = 3;
                    } else {
                        state++;
                        counts[state] = 1;
                    }
                }
            }
        }

        return clusterPatterns(candidates);
    }

    function checkRatio(c) {
        const total = c[0] + c[1] + c[2] + c[3] + c[4];
        if (total < 7) return false;
        const unit = total / 7;
        const tol = unit * 0.5;
        return Math.abs(c[0] - unit) <= tol && Math.abs(c[1] - unit) <= tol &&
            Math.abs(c[2] - 3 * unit) <= tol * 1.5 &&
            Math.abs(c[3] - unit) <= tol && Math.abs(c[4] - unit) <= tol;
    }

    function clusterPatterns(patterns) {
        const clusters = [];
        for (const p of patterns) {
            let merged = false;
            for (const c of clusters) {
                const dist = Math.hypot(p.x - c.x, p.y - c.y);
                if (dist < p.size * 3) {
                    const total = c.n + 1;
                    c.x = (c.x * c.n + p.x) / total;
                    c.y = (c.y * c.n + p.y) / total;
                    c.size = (c.size * c.n + p.size) / total;
                    c.width = (c.width * c.n + p.width) / total;
                    c.n = total;
                    merged = true;
                    break;
                }
            }
            if (!merged) clusters.push({ x: p.x, y: p.y, size: p.size, width: p.width, n: 1 });
        }
        return clusters.filter(c => c.n >= 2).sort((a, b) => b.n - a.n);
    }

    function orderPatterns(pts) {
        if (pts.length < 3) return null;
        const p = pts.slice(0, 3);

        // Sort by sum of coordinates (top-left has smallest sum)
        p.sort((a, b) => (a.x + a.y) - (b.x + b.y));
        const topLeft = p[0];

        // Of remaining two, one with larger X is top-right
        let topRight, bottomLeft;
        if (p[1].x > p[2].x) { topRight = p[1]; bottomLeft = p[2]; }
        else { topRight = p[2]; bottomLeft = p[1]; }

        // Verify with cross product (should be positive)
        const v1x = topRight.x - topLeft.x, v1y = topRight.y - topLeft.y;
        const v2x = bottomLeft.x - topLeft.x, v2y = bottomLeft.y - topLeft.y;
        if (v1x * v2y - v1y * v2x < 0) [topRight, bottomLeft] = [bottomLeft, topRight];

        return { topLeft, topRight, bottomLeft };
    }

    function sampleGrid(binary, width, height, patterns, size) {
        const { topLeft, topRight, bottomLeft } = patterns;
        const moduleCount = size - 7;

        // Vectors from top-left to top-right and bottom-left
        const dxR = (topRight.x - topLeft.x) / moduleCount;
        const dyR = (topRight.y - topLeft.y) / moduleCount;
        const dxD = (bottomLeft.x - topLeft.x) / moduleCount;
        const dyD = (bottomLeft.y - topLeft.y) / moduleCount;

        // Origin: finder center is at (3.5, 3.5), so (0,0) is 3.5 modules before it
        const originX = topLeft.x - 3.5 * dxR - 3.5 * dxD;
        const originY = topLeft.y - 3.5 * dyR - 3.5 * dyD;

        const matrix = [];
        for (let r = 0; r < size; r++) {
            const row = [];
            for (let c = 0; c < size; c++) {
                const px = originX + (c + 0.5) * dxR + (r + 0.5) * dxD;
                const py = originY + (c + 0.5) * dyR + (r + 0.5) * dyD;
                const ix = Math.round(px), iy = Math.round(py);
                row.push(ix >= 0 && ix < width && iy >= 0 && iy < height ? binary[iy * width + ix] : 0);
            }
            matrix.push(row);
        }
        return matrix;
    }

    function readFormat(matrix) {
        let bits = 0;
        for (let c = 0; c <= 5; c++) bits = (bits << 1) | matrix[8][c];
        bits = (bits << 1) | matrix[8][7];
        bits = (bits << 1) | matrix[8][8];
        bits = (bits << 1) | matrix[7][8];
        for (let r = 5; r >= 0; r--) bits = (bits << 1) | matrix[r][8];
        bits ^= 0x5412;
        return { ec: ['M', 'L', 'H', 'Q'][(bits >> 13) & 3], mask: (bits >> 10) & 7 };
    }

    function isFunc(r, c, size, v) {
        if (r < 9 && c < 9) return true;
        if (r < 9 && c >= size - 8) return true;
        if (r >= size - 8 && c < 9) return true;
        if (r === 6 || c === 6) return true;
        if (r === size - 8 && c === 8) return true;
        if (v >= 7) {
            if (r < 6 && c >= size - 11 && c < size - 8) return true;
            if (c < 6 && r >= size - 11 && r < size - 8) return true;
        }
        if (v >= 2) {
            const pos = getAlignPos(v, size);
            for (const ar of pos) {
                for (const ac of pos) {
                    if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) continue;
                    if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true;
                }
            }
        }
        return false;
    }

    function getAlignPos(v, size) {
        if (v === 1) return [];
        const n = Math.floor(v / 7) + 2;
        const first = 6, last = size - 7;
        if (n === 2) return [first, last];
        const step = Math.ceil((last - first) / (n - 1) / 2) * 2;
        const pos = [first];
        for (let i = 1; i < n - 1; i++) pos.push(last - (n - 1 - i) * step);
        pos.push(last);
        return pos;
    }

    function unmask(matrix, size, mask, v) {
        const fns = [
            (r, c) => (r + c) % 2 === 0,
            (r, c) => r % 2 === 0,
            (r, c) => c % 3 === 0,
            (r, c) => (r + c) % 3 === 0,
            (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
            (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
            (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
            (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0
        ];
        const fn = fns[mask];
        return matrix.map((row, r) => row.map((val, c) => !isFunc(r, c, size, v) && fn(r, c) ? val ^ 1 : val));
    }

    function extractBits(matrix, size, v) {
        const bits = [];
        let up = true;
        for (let col = size - 1; col >= 1; col -= 2) {
            if (col === 6) col = 5;
            for (let i = 0; i < size; i++) {
                const row = up ? size - 1 - i : i;
                if (!isFunc(row, col, size, v)) bits.push(matrix[row][col]);
                if (col > 0 && !isFunc(row, col - 1, size, v)) bits.push(matrix[row][col - 1]);
            }
            up = !up;
        }
        return bits;
    }

    function decodeBits(bits, v) {
        let i = 0, result = '';
        const read = n => { let val = 0; for (let j = 0; j < n && i < bits.length; j++) val = (val << 1) | bits[i++]; return val; };

        while (i < bits.length - 4) {
            const mode = read(4);
            if (mode === 0) break;

            if (mode === 4) { // Byte
                const count = read(v < 10 ? 8 : 16);
                for (let j = 0; j < count; j++) { const b = read(8); if (b) result += String.fromCharCode(b); }
            } else if (mode === 2) { // Alphanumeric
                const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
                const count = read(v < 10 ? 9 : v < 27 ? 11 : 13);
                for (let j = 0; j < Math.floor(count / 2); j++) {
                    const val = read(11);
                    result += chars[Math.floor(val / 45)] + chars[val % 45];
                }
                if (count % 2) result += chars[read(6)];
            } else if (mode === 1) { // Numeric
                const count = read(v < 10 ? 10 : v < 27 ? 12 : 14);
                for (let j = 0; j < Math.floor(count / 3); j++) result += String(read(10)).padStart(3, '0');
                if (count % 3 === 2) result += String(read(7)).padStart(2, '0');
                else if (count % 3 === 1) result += String(read(4));
            } else break;
        }
        return result;
    }

    function decode(imageData, width, height) {
        try {
            const binary = binarize(imageData, width, height);
            const patterns = findFinderPatterns(binary, width, height);
            if (patterns.length < 3) return null;

            const ordered = orderPatterns(patterns);
            if (!ordered) return null;

            // Calculate version from distance between finder centers
            const dist = Math.hypot(ordered.topRight.x - ordered.topLeft.x, ordered.topRight.y - ordered.topLeft.y);
            const avgSize = (ordered.topLeft.size + ordered.topRight.size + ordered.bottomLeft.size) / 3;

            // Distance = (size - 7) * moduleSize, and size = version * 4 + 17
            // So: version = ((dist / moduleSize) + 7 - 17) / 4 = (dist / moduleSize - 10) / 4
            const estModules = dist / avgSize;
            const version = Math.max(1, Math.min(40, Math.round((estModules - 10) / 4)));
            const size = version * 4 + 17;

            const matrix = sampleGrid(binary, width, height, ordered, size);
            const format = readFormat(matrix);
            const unmasked = unmask(matrix, size, format.mask, version);
            const bits = extractBits(unmasked, size, version);
            return decodeBits(bits, version) || null;
        } catch (e) {
            return null;
        }
    }

    return { decode };
})();
