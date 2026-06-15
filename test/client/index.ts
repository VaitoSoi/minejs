import { TCPClient } from "../../src/client/tcp";

const client = new TCPClient({
    playerName: "bot",
    host: "localhost",
    port: 25565,
    protocolVersion: 773
});
client.connect();