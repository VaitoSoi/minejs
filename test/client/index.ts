import { TCPClient } from "../../src/client/tcp";

const client = new TCPClient({
    playerName: "bot",
    host: "localhost",
    port: 25565,
    protocolVersion: 773,
    debug: {
        packetLogger: true
    },
    isOffline: true,
    loadRegistry: false,
    // auth: {
    //     client_id: "d86254d8-edf7-4640-90eb-643c99af188e",
    //     method: "loopback",
    //     openBrowser: true
    // }
});
client.connect();