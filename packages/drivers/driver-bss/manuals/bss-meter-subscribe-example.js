import net from "net";

const host = "10.54.17.42";
const port = 1023;

// Reverse of substituteBytes()
function unsubstituteBytes(bytes) {
	const reverseMap = {
		0x82: 0x02,
		0x83: 0x03,
		0x86: 0x06,
		0x95: 0x15,
		0x9b: 0x1b,
	};

	const result = [];
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0x1b && i + 1 < bytes.length && reverseMap[bytes[i + 1]] !== undefined) {
			result.push(reverseMap[bytes[i + 1]]);
			i++; // skip the next byte, already consumed
		} else {
			result.push(bytes[i]);
		}
	}
	return result;
}

function parseMessage(buffer) {
	// Strip framing 0x02 ... 0x03
	const inner = buffer.slice(1, buffer.length - 1);
	const bytes = unsubstituteBytes([...inner]);

	// bytes layout: messageType(1) nodeAddress(2) virtualDevice(1) objectId(3) paramId(2) value(4) checksum(1)
	const messageType = bytes[0];
	const nodeAddress = bytes.slice(1, 3);
	const virtualDevice = bytes[3];
	const objectId = bytes.slice(4, 7);
	const paramId = bytes.slice(7, 9);
	const valueBytes = bytes.slice(9, 13);
	const checksum = bytes[13];

	// Convert 4 bytes to signed 32-bit integer (big-endian)
	const valueBuf = Buffer.from(valueBytes);
	const rawValue = valueBuf.readInt32BE(0);

	const dB = rawValue / 10000;

	// Map -80dB..+40dB (-800000..400000 raw) onto 0%..100%
	const percent = ((rawValue + 800000) / 1200000) * 100;

	return { messageType, nodeAddress, virtualDevice, objectId, paramId, rawValue, dB, percent, checksum };
}

const client = new net.Socket();

const subscribeHex = "02891DFE1B830000010000000000006803";
client.connect(port, host, () => {
	console.log("Connected, sending subscribe message...");
	client.write(Buffer.from(subscribeHex, "hex"));
});

client.on("data", (data) => {
	try {
		const parsed = parseMessage(data);
		console.log(`dB: ${parsed.dB.toFixed(2)}  (${parsed.percent.toFixed(1)}%)`);
	} catch (err) {
		console.error("Parse error:", err.message, "raw:", data.toString("hex"));
	}
});

client.on("close", () => console.log("Connection closed"));
client.on("error", (err) => console.error("Socket error:", err.message));

process.on("SIGINT", () => {
	client.destroy();
	process.exit(0);
});