// Very simple but working script of sending a simple message

import net from "net";

const host = "10.54.17.42"; // change this to the IP of your DSP
const port = 1023;

// Construct the raw message
const messageType = 0x88; // SET
const nodeAddress = [0x1d, 0xfe];
const virtualDevice = 0x03;
const objectId = [0x00, 0x01, 0x09];
const paramId = [0x00, 0x60];
const value = [0xff, 0xff, 0xff, 0xff];

// Without substitution or framing
let body = [
	messageType,
	...nodeAddress,
	virtualDevice,
	...objectId,
	...paramId,
	...value,
];

// Calculate checksum (XOR of body)
const checksum = body.reduce((acc, byte) => acc ^ byte, 0);
console.log("Checksum:", checksum.toString(16).padStart(2, "0"));

// Full message before substitution
let rawMessage = [...body, checksum];

// Byte substitution
function substituteBytes(message) {
	const substitutions = {
		0x02: [0x1b, 0x82],
		0x03: [0x1b, 0x83],
		0x06: [0x1b, 0x86],
		0x15: [0x1b, 0x95],
		0x1b: [0x1b, 0x9b],
	};

	return message.flatMap((byte) =>
		substitutions[byte] ? substitutions[byte] : [byte]
	);
}

const substitutedMessage = substituteBytes(rawMessage);
console.log(
	"Substituted Message:",
	substitutedMessage.map((b) => b.toString(16).padStart(2, "0")).join(" ")
);

const finalMessage = Buffer.from([0x02, ...substitutedMessage, 0x03]);
console.log(
	"Final Message:",
	finalMessage.map((b) => b.toString(16).padStart(2, "0")).join(" ")
);

function generateMessage(
	messageType,
	nodeAddress,
	virtualDevice,
	objectId,
	paramId,
	value
) {
	let body = [
		messageType,
		...nodeAddress,
		virtualDevice,
		...objectId,
		...paramId,
		...value,
	];

	const checksum = body.reduce((acc, byte) => acc ^ byte, 0);
	body.push(checksum);

	return Buffer.from([0x02, ...substituteBytes(body), 0x03]);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// TCP send
const client = new net.Socket();
client.connect(port, host, () => {
	console.log("Connected, sending message...");
	client.write(
		generateMessage(
			messageType,
			nodeAddress,
			virtualDevice,
			objectId,
			paramId,
			[0xff, 0xff, 0xff, 0xff]
		)
	);
	setTimeout(() => {
		client.destroy();
	}, 4000);
});

client.on("data", (data) => {
	console.log("Received:", data.toString("hex"));
	// client.destroy();
});

client.on("close", () => {
	console.log("Connection closed");
});
