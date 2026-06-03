/* 
    <DaliMessage Version="1.0">
	<Query>
		<Screen ScreenType="Scene" />
		<Screen ScreenType="Device" />
		<Screen ScreenType="Group" />
	</Query>
</DaliMessage>;

*/

// I need to send the xml above to 10.54.17.93:5566 using TCP

import net from "net";

const xml = `
<DaliMessage Version="1.0">
 <Command><Button Index="M84" State="1" /></Command>
</DaliMessage>
`;

const host = "10.54.17.93";
const port = 5566;

// Create a TCP client
const client = new net.Socket();

// Connect to the server
client.connect(port, host, () => {
	console.log("Connected to server");

	// Send the XML data
	client.write(xml);
});

// Handle incoming data
client.on("data", (data) => {
	console.log("Received:", data.toString());

	// fs.appendFile("response.xml", data.toString(), (err) => {
	// 	if (err) {
	// 		console.error("Error writing to file:", err);
	// 	} else {
	// 		console.log("Response saved to response.xml");
	// 	}
	// });
});

// Handle connection close
client.on("close", () => {
	console.log("Connection closed");
});
