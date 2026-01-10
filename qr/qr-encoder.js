/**
 * Pure JavaScript QR Code Encoder
 * Supports Version 1-40, Error Correction Levels L/M/Q/H
 * Maximum capacity: ~2,953 bytes (Version 40, Level L)
 */

const QREncoder = (() => {
    // Galois Field tables for Reed-Solomon
    const GF_EXP = new Array(512);
    const GF_LOG = new Array(256);

    // Initialize Galois Field
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
        return GF_EXP[GF_LOG[x] + GF_LOG[y]];
    }

    function gfPow(x, power) {
        return GF_EXP[(GF_LOG[x] * power) % 255];
    }

    function gfPolyMul(p, q) {
        const result = new Array(p.length + q.length - 1).fill(0);
        for (let i = 0; i < p.length; i++) {
            for (let j = 0; j < q.length; j++) {
                result[i + j] ^= gfMul(p[i], q[j]);
            }
        }
        return result;
    }

    function rsGeneratorPoly(nsym) {
        let g = [1];
        for (let i = 0; i < nsym; i++) {
            g = gfPolyMul(g, [1, gfPow(2, i)]);
        }
        return g;
    }

    function rsEncode(data, nsym) {
        const gen = rsGeneratorPoly(nsym);
        const res = new Array(data.length + nsym).fill(0);
        for (let i = 0; i < data.length; i++) res[i] = data[i];

        for (let i = 0; i < data.length; i++) {
            const coef = res[i];
            if (coef !== 0) {
                for (let j = 0; j < gen.length; j++) {
                    res[i + j] ^= gfMul(gen[j], coef);
                }
            }
        }
        return res.slice(data.length);
    }

    // QR Code version data - Total codewords per version
    const TOTAL_CODEWORDS = [
        26, 44, 70, 100, 134, 172, 196, 242, 292, 346,           // 1-10
        404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,       // 11-20
        1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051,    // 21-29
        2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362,    // 30-38
        3532, 3706                                                // 39-40
    ];

    // Error correction codewords per block for each version and level
    // Format: [ecCodewordsPerBlock, numBlocks (group1), dataCodewordsPerBlock (group1), numBlocks (group2), dataCodewordsPerBlock (group2)]
    const EC_BLOCKS = {
        L: [
            [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0],
            [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0],
            [30, 2, 116, 0, 0], [18, 2, 68, 2, 69], [20, 4, 81, 0, 0], [24, 2, 92, 2, 93],
            [26, 4, 107, 0, 0], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88], [24, 5, 98, 1, 99],
            [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114], [28, 3, 107, 5, 108],
            [28, 4, 116, 4, 117], [28, 2, 111, 7, 112], [30, 4, 121, 5, 122], [30, 6, 117, 4, 118],
            [26, 8, 106, 4, 107], [28, 10, 114, 2, 115], [30, 8, 122, 4, 123], [30, 3, 117, 10, 118],
            [30, 7, 116, 7, 117], [30, 5, 115, 10, 116], [30, 13, 115, 3, 116], [30, 17, 115, 0, 0],
            [30, 17, 115, 1, 116], [30, 13, 115, 6, 116], [30, 12, 121, 7, 122], [30, 6, 121, 14, 122],
            [30, 17, 122, 4, 123], [30, 4, 122, 18, 123], [30, 20, 117, 4, 118], [30, 19, 118, 6, 119]
        ],
        M: [
            [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
            [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
            [22, 3, 36, 2, 37], [26, 4, 43, 1, 44], [30, 1, 50, 4, 51], [22, 6, 36, 2, 37],
            [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46],
            [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
            [26, 17, 42, 0, 0], [28, 17, 46, 0, 0], [28, 4, 47, 14, 48], [28, 6, 45, 14, 46],
            [28, 8, 47, 13, 48], [28, 19, 46, 4, 47], [28, 22, 45, 3, 46], [28, 3, 45, 23, 46],
            [28, 21, 45, 7, 46], [28, 19, 47, 10, 48], [28, 2, 46, 29, 47], [28, 10, 46, 23, 47],
            [28, 14, 46, 21, 47], [28, 14, 46, 23, 47], [28, 12, 47, 26, 48], [28, 6, 47, 34, 48],
            [28, 29, 46, 14, 47], [28, 13, 46, 32, 47], [28, 40, 47, 7, 48], [28, 18, 47, 31, 48]
        ],
        Q: [
            [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0],
            [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19],
            [20, 4, 16, 4, 17], [24, 6, 19, 2, 20], [28, 4, 22, 4, 23], [26, 4, 20, 6, 21],
            [24, 8, 20, 4, 21], [20, 11, 16, 5, 17], [30, 5, 24, 7, 25], [24, 15, 19, 2, 20],
            [28, 1, 22, 15, 23], [28, 17, 22, 1, 23], [26, 17, 21, 4, 22], [30, 15, 24, 5, 25],
            [28, 17, 22, 6, 23], [30, 7, 24, 16, 25], [30, 11, 24, 14, 25], [30, 11, 24, 16, 25],
            [30, 7, 24, 22, 25], [28, 28, 22, 6, 23], [30, 8, 23, 26, 24], [30, 4, 24, 31, 25],
            [30, 1, 23, 37, 24], [30, 15, 24, 25, 25], [30, 42, 24, 1, 25], [30, 10, 24, 35, 25],
            [30, 29, 24, 19, 25], [30, 44, 24, 7, 25], [30, 39, 24, 14, 25], [30, 46, 24, 10, 25],
            [30, 49, 24, 10, 25], [30, 48, 24, 14, 25], [30, 43, 24, 22, 25], [30, 34, 24, 34, 25]
        ],
        H: [
            [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0],
            [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15],
            [24, 4, 12, 4, 13], [28, 6, 15, 2, 16], [24, 3, 12, 8, 13], [28, 7, 14, 4, 15],
            [22, 12, 11, 4, 12], [24, 11, 12, 5, 13], [24, 11, 12, 7, 13], [30, 3, 15, 13, 16],
            [28, 2, 14, 17, 15], [28, 2, 14, 19, 15], [26, 9, 13, 16, 14], [28, 15, 15, 10, 16],
            [30, 19, 16, 6, 17], [24, 34, 13, 0, 0], [30, 16, 15, 14, 16], [30, 30, 16, 2, 17],
            [30, 22, 15, 13, 16], [30, 33, 16, 4, 17], [30, 12, 15, 28, 16], [30, 11, 15, 31, 16],
            [30, 19, 15, 26, 16], [30, 23, 15, 25, 16], [30, 23, 15, 28, 16], [30, 19, 15, 35, 16],
            [30, 11, 15, 46, 16], [30, 59, 16, 1, 17], [30, 22, 15, 41, 16], [30, 2, 15, 64, 16],
            [30, 24, 15, 46, 16], [30, 42, 15, 32, 16], [30, 10, 15, 67, 16], [30, 20, 15, 61, 16]
        ]
    };

    // Calculate data capacity for each version and level
    function getDataCapacity(version, ecLevel) {
        const blocks = EC_BLOCKS[ecLevel][version - 1];
        const [ecPerBlock, blocks1, data1, blocks2, data2] = blocks;
        return blocks1 * data1 + blocks2 * data2;
    }

    // Alignment pattern positions for each version
    const ALIGNMENT_POSITIONS = [
        [],                                          // Version 1
        [6, 18],                                     // Version 2
        [6, 22],                                     // Version 3
        [6, 26],                                     // Version 4
        [6, 30],                                     // Version 5
        [6, 34],                                     // Version 6
        [6, 22, 38],                                 // Version 7
        [6, 24, 42],                                 // Version 8
        [6, 26, 46],                                 // Version 9
        [6, 28, 50],                                 // Version 10
        [6, 30, 54],                                 // Version 11
        [6, 32, 58],                                 // Version 12
        [6, 34, 62],                                 // Version 13
        [6, 26, 46, 66],                             // Version 14
        [6, 26, 48, 70],                             // Version 15
        [6, 26, 50, 74],                             // Version 16
        [6, 30, 54, 78],                             // Version 17
        [6, 30, 56, 82],                             // Version 18
        [6, 30, 58, 86],                             // Version 19
        [6, 34, 62, 90],                             // Version 20
        [6, 28, 50, 72, 94],                         // Version 21
        [6, 26, 50, 74, 98],                         // Version 22
        [6, 30, 54, 78, 102],                        // Version 23
        [6, 28, 54, 80, 106],                        // Version 24
        [6, 32, 58, 84, 110],                        // Version 25
        [6, 30, 58, 86, 114],                        // Version 26
        [6, 34, 62, 90, 118],                        // Version 27
        [6, 26, 50, 74, 98, 122],                    // Version 28
        [6, 30, 54, 78, 102, 126],                   // Version 29
        [6, 26, 52, 78, 104, 130],                   // Version 30
        [6, 30, 56, 82, 108, 134],                   // Version 31
        [6, 34, 60, 86, 112, 138],                   // Version 32
        [6, 30, 58, 86, 114, 142],                   // Version 33
        [6, 34, 62, 90, 118, 146],                   // Version 34
        [6, 30, 54, 78, 102, 126, 150],              // Version 35
        [6, 24, 50, 76, 102, 128, 154],              // Version 36
        [6, 28, 54, 80, 106, 132, 158],              // Version 37
        [6, 32, 58, 84, 110, 136, 162],              // Version 38
        [6, 26, 54, 82, 110, 138, 166],              // Version 39
        [6, 30, 58, 86, 114, 142, 170]               // Version 40
    ];

    // Version information for versions 7-40 (BCH encoded)
    const VERSION_INFO = [
        0x07C94, 0x085BC, 0x09A99, 0x0A4D3, 0x0BBF6, 0x0C762, 0x0D847, 0x0E60D,
        0x0F928, 0x10B78, 0x1145D, 0x12A17, 0x13532, 0x149A6, 0x15683, 0x168C9,
        0x177EC, 0x18EC4, 0x191E1, 0x1AFAB, 0x1B08E, 0x1CC1A, 0x1D33F, 0x1ED75,
        0x1F250, 0x209D5, 0x216F0, 0x228BA, 0x2379F, 0x24B0B, 0x2542E, 0x26A64,
        0x27541, 0x28C69
    ];

    // Format information (precomputed BCH codes)
    const FORMAT_INFO = {
        L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
        M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
        Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
        H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b]
    };

    function getVersion(data, ecLevel) {
        const len = data.length;
        for (let v = 1; v <= 40; v++) {
            const capacity = getDataCapacity(v, ecLevel);
            // Byte mode: 4 bits mode + 8/16 bits length + data + 4 bits terminator
            const countBits = v < 10 ? 8 : 16;
            const headerBits = 4 + countBits;
            const available = capacity * 8 - headerBits - 4;
            if (len * 8 <= available) return v;
        }
        throw new Error('Data too long for QR code (max ~2953 bytes)');
    }

    function encodeData(data, version, ecLevel) {
        const capacity = getDataCapacity(version, ecLevel);
        const bits = [];

        // Mode indicator (byte mode = 0100)
        bits.push(0, 1, 0, 0);

        // Character count
        const countBits = version < 10 ? 8 : 16;
        for (let i = countBits - 1; i >= 0; i--) {
            bits.push((data.length >> i) & 1);
        }

        // Data bytes
        for (let i = 0; i < data.length; i++) {
            const byte = data.charCodeAt(i) & 0xFF;
            for (let j = 7; j >= 0; j--) {
                bits.push((byte >> j) & 1);
            }
        }

        // Terminator (up to 4 zeros)
        const remaining = capacity * 8 - bits.length;
        for (let i = 0; i < Math.min(4, remaining); i++) {
            bits.push(0);
        }

        // Pad to byte boundary
        while (bits.length % 8 !== 0) bits.push(0);

        // Pad bytes (alternating 0xEC and 0x11)
        const padBytes = [0xec, 0x11];
        let padIndex = 0;
        while (bits.length < capacity * 8) {
            const pad = padBytes[padIndex % 2];
            for (let j = 7; j >= 0; j--) {
                bits.push((pad >> j) & 1);
            }
            padIndex++;
        }

        // Convert to bytes
        const bytes = [];
        for (let i = 0; i < bits.length; i += 8) {
            let byte = 0;
            for (let j = 0; j < 8; j++) {
                byte = (byte << 1) | bits[i + j];
            }
            bytes.push(byte);
        }

        return bytes;
    }

    function addErrorCorrection(dataBytes, version, ecLevel) {
        const blocks = EC_BLOCKS[ecLevel][version - 1];
        const [ecPerBlock, blocks1, data1, blocks2, data2] = blocks;

        const dataBlocks = [];
        const ecBlocks = [];
        let dataIndex = 0;

        // Split data into blocks and add EC to each
        for (let i = 0; i < blocks1; i++) {
            const block = dataBytes.slice(dataIndex, dataIndex + data1);
            dataBlocks.push(block);
            ecBlocks.push(rsEncode(block, ecPerBlock));
            dataIndex += data1;
        }

        for (let i = 0; i < blocks2; i++) {
            const block = dataBytes.slice(dataIndex, dataIndex + data2);
            dataBlocks.push(block);
            ecBlocks.push(rsEncode(block, ecPerBlock));
            dataIndex += data2;
        }

        // Interleave data blocks
        const result = [];
        const maxDataLen = Math.max(data1, data2);
        for (let i = 0; i < maxDataLen; i++) {
            for (const block of dataBlocks) {
                if (i < block.length) result.push(block[i]);
            }
        }

        // Interleave EC blocks
        for (let i = 0; i < ecPerBlock; i++) {
            for (const block of ecBlocks) {
                result.push(block[i]);
            }
        }

        return result;
    }

    function createMatrix(version) {
        const size = version * 4 + 17;
        const matrix = [];
        const reserved = [];
        for (let i = 0; i < size; i++) {
            matrix.push(new Array(size).fill(0));
            reserved.push(new Array(size).fill(false));
        }
        return { matrix, reserved, size };
    }

    function addFinderPattern(matrix, reserved, row, col) {
        for (let r = -1; r <= 7; r++) {
            for (let c = -1; c <= 7; c++) {
                const nr = row + r, nc = col + c;
                if (nr < 0 || nr >= matrix.length || nc < 0 || nc >= matrix.length) continue;

                let val = 0;
                if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
                    if (r === 0 || r === 6 || c === 0 || c === 6 ||
                        (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
                        val = 1;
                    }
                }
                matrix[nr][nc] = val;
                reserved[nr][nc] = true;
            }
        }
    }

    function addAlignmentPattern(matrix, reserved, row, col) {
        for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
                const nr = row + r, nc = col + c;
                if (nr < 0 || nr >= matrix.length || nc < 0 || nc >= matrix.length) continue;
                if (reserved[nr][nc]) return;
            }
        }
        for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
                const nr = row + r, nc = col + c;
                const val = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) ? 1 : 0;
                matrix[nr][nc] = val;
                reserved[nr][nc] = true;
            }
        }
    }

    function addTimingPatterns(matrix, reserved, size) {
        for (let i = 8; i < size - 8; i++) {
            const val = (i + 1) % 2;
            matrix[6][i] = val;
            matrix[i][6] = val;
            reserved[6][i] = true;
            reserved[i][6] = true;
        }
    }

    function addVersionInfo(matrix, reserved, size, version) {
        if (version < 7) return;

        const info = VERSION_INFO[version - 7];

        // Bottom-left
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 3; j++) {
                const bit = (info >> (i * 3 + j)) & 1;
                matrix[size - 11 + j][i] = bit;
                reserved[size - 11 + j][i] = true;
            }
        }

        // Top-right
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 3; j++) {
                const bit = (info >> (i * 3 + j)) & 1;
                matrix[i][size - 11 + j] = bit;
                reserved[i][size - 11 + j] = true;
            }
        }
    }

    function addFormatInfo(matrix, reserved, size, ecLevel, mask) {
        const info = FORMAT_INFO[ecLevel][mask];

        // Around top-left finder
        for (let i = 0; i <= 5; i++) {
            matrix[8][i] = (info >> (14 - i)) & 1;
            reserved[8][i] = true;
        }
        matrix[8][7] = (info >> 8) & 1;
        reserved[8][7] = true;
        matrix[8][8] = (info >> 7) & 1;
        reserved[8][8] = true;
        matrix[7][8] = (info >> 6) & 1;
        reserved[7][8] = true;
        for (let i = 0; i <= 5; i++) {
            matrix[5 - i][8] = (info >> (5 - i)) & 1;
            reserved[5 - i][8] = true;
        }

        // Around top-right and bottom-left
        for (let i = 0; i <= 7; i++) {
            matrix[8][size - 1 - i] = (info >> i) & 1;
            reserved[8][size - 1 - i] = true;
        }
        for (let i = 0; i <= 6; i++) {
            matrix[size - 1 - i][8] = (info >> (14 - i)) & 1;
            reserved[size - 1 - i][8] = true;
        }

        // Dark module
        matrix[size - 8][8] = 1;
        reserved[size - 8][8] = true;
    }

    function placeData(matrix, reserved, size, data) {
        // Convert to bits
        const bits = [];
        for (const byte of data) {
            for (let i = 7; i >= 0; i--) {
                bits.push((byte >> i) & 1);
            }
        }

        let bitIndex = 0;
        let upward = true;

        for (let col = size - 1; col >= 0; col -= 2) {
            if (col === 6) col = 5;

            for (let row = 0; row < size; row++) {
                const actualRow = upward ? size - 1 - row : row;

                for (let c = 0; c < 2; c++) {
                    const actualCol = col - c;
                    if (!reserved[actualRow][actualCol]) {
                        matrix[actualRow][actualCol] = bitIndex < bits.length ? bits[bitIndex++] : 0;
                    }
                }
            }
            upward = !upward;
        }
    }

    function applyMask(matrix, reserved, size, mask) {
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
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (!reserved[r][c] && fn(r, c)) {
                    matrix[r][c] ^= 1;
                }
            }
        }
    }

    function scorePenalty(matrix, size) {
        let penalty = 0;

        // Rule 1: 5+ same color in row/column
        for (let r = 0; r < size; r++) {
            let count = 1;
            for (let c = 1; c < size; c++) {
                if (matrix[r][c] === matrix[r][c - 1]) {
                    count++;
                } else {
                    if (count >= 5) penalty += count - 2;
                    count = 1;
                }
            }
            if (count >= 5) penalty += count - 2;
        }

        for (let c = 0; c < size; c++) {
            let count = 1;
            for (let r = 1; r < size; r++) {
                if (matrix[r][c] === matrix[r - 1][c]) {
                    count++;
                } else {
                    if (count >= 5) penalty += count - 2;
                    count = 1;
                }
            }
            if (count >= 5) penalty += count - 2;
        }

        // Rule 2: 2x2 blocks
        for (let r = 0; r < size - 1; r++) {
            for (let c = 0; c < size - 1; c++) {
                const val = matrix[r][c];
                if (val === matrix[r][c + 1] && val === matrix[r + 1][c] && val === matrix[r + 1][c + 1]) {
                    penalty += 3;
                }
            }
        }

        return penalty;
    }

    function generate(text, ecLevel = 'M') {
        const version = getVersion(text, ecLevel);
        const dataBytes = encodeData(text, version, ecLevel);
        const finalData = addErrorCorrection(dataBytes, version, ecLevel);

        let bestMatrix = null;
        let bestPenalty = Infinity;

        for (let mask = 0; mask < 8; mask++) {
            const { matrix, reserved, size } = createMatrix(version);

            // Add finder patterns
            addFinderPattern(matrix, reserved, 0, 0);
            addFinderPattern(matrix, reserved, 0, size - 7);
            addFinderPattern(matrix, reserved, size - 7, 0);

            // Add alignment patterns
            if (version >= 2) {
                const positions = ALIGNMENT_POSITIONS[version - 1];
                for (const r of positions) {
                    for (const c of positions) {
                        addAlignmentPattern(matrix, reserved, r, c);
                    }
                }
            }

            // Add timing patterns
            addTimingPatterns(matrix, reserved, size);

            // Add version info (for versions >= 7)
            addVersionInfo(matrix, reserved, size, version);

            // Reserve format info areas
            addFormatInfo(matrix, reserved, size, ecLevel, mask);

            // Place data
            placeData(matrix, reserved, size, finalData);

            // Apply mask
            applyMask(matrix, reserved, size, mask);

            // Score and select best
            const penalty = scorePenalty(matrix, size);
            if (penalty < bestPenalty) {
                bestPenalty = penalty;
                bestMatrix = matrix;
            }
        }

        return { matrix: bestMatrix, size: bestMatrix.length };
    }

    function renderToCanvas(data, canvas, options = {}) {
        const { scale = 8, margin = 4 } = options;
        const { matrix, size } = data;

        const totalSize = (size + margin * 2) * scale;
        canvas.width = totalSize;
        canvas.height = totalSize;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, totalSize, totalSize);

        ctx.fillStyle = '#000000';
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (matrix[r][c]) {
                    ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
                }
            }
        }
    }

    // Get maximum capacity for a given error correction level
    function getMaxCapacity(ecLevel = 'M') {
        return getDataCapacity(40, ecLevel);
    }

    return { generate, renderToCanvas, getMaxCapacity };
})();
