/**
 * QR Stream - Visual Data Transfer Protocol
 * Enables unlimited data transfer via rapid QR code display
 */

const QRStream = (() => {
    const MAGIC = 'QS';
    const HEADER_SIZE = 9; // 2 magic + 2 seq + 2 total + 1 flags + 2 checksum
    const DEFAULT_CHUNK_SIZE = 1800; // bytes per QR (leave room for header)

    // Flags
    const FLAG_FIRST = 0x01;
    const FLAG_LAST = 0x02;
    const FLAG_RETRANSMIT = 0x04;
    const FLAG_ACK = 0x08;

    // CRC-16 (CCITT)
    function crc16(data) {
        let crc = 0xFFFF;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i] << 8;
            for (let j = 0; j < 8; j++) {
                if (crc & 0x8000) {
                    crc = (crc << 1) ^ 0x1021;
                } else {
                    crc <<= 1;
                }
            }
            crc &= 0xFFFF;
        }
        return crc;
    }

    // Encode packet to binary string for QR
    function encodePacket(seq, total, flags, data) {
        const checksum = crc16(data);
        const packet = new Uint8Array(HEADER_SIZE + data.length);

        // Magic
        packet[0] = MAGIC.charCodeAt(0);
        packet[1] = MAGIC.charCodeAt(1);

        // Sequence (big-endian)
        packet[2] = (seq >> 8) & 0xFF;
        packet[3] = seq & 0xFF;

        // Total
        packet[4] = (total >> 8) & 0xFF;
        packet[5] = total & 0xFF;

        // Flags
        packet[6] = flags;

        // Checksum
        packet[7] = (checksum >> 8) & 0xFF;
        packet[8] = checksum & 0xFF;

        // Data
        packet.set(data, HEADER_SIZE);

        // Convert to binary string for QR encoding
        return String.fromCharCode(...packet);
    }

    // Decode packet from QR data
    function decodePacket(str) {
        if (str.length < HEADER_SIZE) return null;

        const data = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) {
            data[i] = str.charCodeAt(i);
        }

        // Check magic
        if (data[0] !== MAGIC.charCodeAt(0) || data[1] !== MAGIC.charCodeAt(1)) {
            return null;
        }

        const seq = (data[2] << 8) | data[3];
        const total = (data[4] << 8) | data[5];
        const flags = data[6];
        const checksum = (data[7] << 8) | data[8];
        const payload = data.slice(HEADER_SIZE);

        // Verify checksum
        if (crc16(payload) !== checksum) {
            return { error: 'checksum', seq };
        }

        return { seq, total, flags, data: payload };
    }

    /**
     * Sender - splits data and generates QR packets
     */
    class Sender {
        constructor(data, options = {}) {
            this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
            this.fps = options.fps || 15;

            // Convert to Uint8Array
            if (typeof data === 'string') {
                this.data = new TextEncoder().encode(data);
            } else if (data instanceof ArrayBuffer) {
                this.data = new Uint8Array(data);
            } else {
                this.data = data;
            }

            this.packets = this._createPackets();
            this.currentIndex = 0;
            this.retransmitQueue = [];
            this.isPlaying = false;
            this.onPacket = null; // callback(packetString, index, total)
            this.onComplete = null;
        }

        _createPackets() {
            const packets = [];
            const totalChunks = Math.ceil(this.data.length / this.chunkSize);

            for (let i = 0; i < totalChunks; i++) {
                const start = i * this.chunkSize;
                const end = Math.min(start + this.chunkSize, this.data.length);
                const chunk = this.data.slice(start, end);

                let flags = 0;
                if (i === 0) flags |= FLAG_FIRST;
                if (i === totalChunks - 1) flags |= FLAG_LAST;

                packets.push(encodePacket(i, totalChunks, flags, chunk));
            }

            return packets;
        }

        get totalPackets() {
            return this.packets.length;
        }

        getPacket(index) {
            return this.packets[index];
        }

        getNextPacket() {
            // Priority: retransmit queue first
            if (this.retransmitQueue.length > 0) {
                const seq = this.retransmitQueue.shift();
                return { packet: this.packets[seq], seq, isRetransmit: true };
            }

            if (this.currentIndex >= this.packets.length) {
                return null;
            }

            const seq = this.currentIndex++;
            return { packet: this.packets[seq], seq, isRetransmit: false };
        }

        requestRetransmit(sequences) {
            this.retransmitQueue.push(...sequences);
        }

        reset() {
            this.currentIndex = 0;
            this.retransmitQueue = [];
        }

        start() {
            this.isPlaying = true;
            this._tick();
        }

        stop() {
            this.isPlaying = false;
        }

        _tick() {
            if (!this.isPlaying) return;

            const next = this.getNextPacket();
            if (next && this.onPacket) {
                this.onPacket(next.packet, next.seq, this.totalPackets);
            }

            if (next) {
                setTimeout(() => this._tick(), 1000 / this.fps);
            } else if (this.onComplete) {
                this.onComplete();
            }
        }
    }

    /**
     * Receiver - collects packets and reassembles data
     */
    class Receiver {
        constructor() {
            this.packets = new Map(); // seq -> Uint8Array
            this.totalPackets = null;
            this.checksumErrors = new Set();
            this.onProgress = null; // callback(received, total, missing)
            this.onComplete = null; // callback(data)
        }

        receive(qrData) {
            const packet = decodePacket(qrData);

            if (!packet) return { accepted: false, reason: 'invalid' };

            if (packet.error === 'checksum') {
                this.checksumErrors.add(packet.seq);
                return { accepted: false, reason: 'checksum', seq: packet.seq };
            }

            // Store packet
            if (!this.packets.has(packet.seq)) {
                this.packets.set(packet.seq, packet.data);
                this.checksumErrors.delete(packet.seq);
            }

            // Update total if we didn't know it
            if (this.totalPackets === null) {
                this.totalPackets = packet.total;
            }

            // Progress callback
            if (this.onProgress) {
                this.onProgress(
                    this.packets.size,
                    this.totalPackets,
                    this.getMissingSequences()
                );
            }

            // Check completion
            if (this.isComplete() && this.onComplete) {
                this.onComplete(this.reassemble());
            }

            return { accepted: true, seq: packet.seq, total: packet.total };
        }

        getMissingSequences() {
            if (this.totalPackets === null) return [];

            const missing = [];
            for (let i = 0; i < this.totalPackets; i++) {
                if (!this.packets.has(i)) {
                    missing.push(i);
                }
            }
            return missing;
        }

        isComplete() {
            return this.totalPackets !== null &&
                this.packets.size === this.totalPackets;
        }

        reassemble() {
            if (!this.isComplete()) return null;

            // Calculate total size
            let totalSize = 0;
            for (let i = 0; i < this.totalPackets; i++) {
                totalSize += this.packets.get(i).length;
            }

            // Combine packets
            const result = new Uint8Array(totalSize);
            let offset = 0;
            for (let i = 0; i < this.totalPackets; i++) {
                const chunk = this.packets.get(i);
                result.set(chunk, offset);
                offset += chunk.length;
            }

            return result;
        }

        getProgress() {
            return {
                received: this.packets.size,
                total: this.totalPackets,
                missing: this.getMissingSequences(),
                checksumErrors: [...this.checksumErrors],
                complete: this.isComplete()
            };
        }

        reset() {
            this.packets.clear();
            this.totalPackets = null;
            this.checksumErrors.clear();
        }
    }

    // Create a NACK (retransmit request) packet
    function createNackPacket(missingSequences) {
        // Encode missing sequences as comma-separated
        const data = new TextEncoder().encode(missingSequences.join(','));
        return encodePacket(0, 0, FLAG_RETRANSMIT, data);
    }

    // Parse a NACK packet
    function parseNackPacket(qrData) {
        const packet = decodePacket(qrData);
        if (!packet || !(packet.flags & FLAG_RETRANSMIT)) return null;

        const str = new TextDecoder().decode(packet.data);
        return str.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    }

    return {
        Sender,
        Receiver,
        encodePacket,
        decodePacket,
        createNackPacket,
        parseNackPacket,
        crc16,
        HEADER_SIZE,
        DEFAULT_CHUNK_SIZE,
        FLAG_FIRST,
        FLAG_LAST,
        FLAG_RETRANSMIT,
        FLAG_ACK
    };
})();
