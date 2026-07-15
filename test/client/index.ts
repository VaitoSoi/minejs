import { MoveDirection, Client } from "../../src/";

const client = new Client({
    playerName: "bot",
    host: "localhost",
    port: 25565,
    protocolVersion: 773,
    // debug: {
    //     packetLogger: true
    // },
    isOffline: true,
    loadRegistry: false,
    // auth: {
    //     client_id: "d86254d8-edf7-4640-90eb-643c99af188e",
    //     method: "loopback",
    //     openBrowser: true
    // }
});
client.connect();
// client.on("loadChunk", (...args) => console.dir({ name: "loadChunk", args }, { depth: null }));
// client.on("unloadChunk", (...args) => console.dir({ name: "unloadChunk", args }, { depth: null }));
// client.on("spawnEntity", (...args) => console.dir({ name: "spawnEntity", args }, { depth: null }));
// client.on("updateEntity", (...args) => console.dir({ name: "updateEntity", args }, { depth: null }));
// client.on("removeEntity", (...args) => console.dir({ name: "removeEntity", args }, { depth: null }));
client.on("playerPosition", (...args) => console.dir({ name: "playerPosition", args }, { depth: null }));
client.on("message", (...args) => console.dir({ name: "message", args }, { depth: null }));
client.on("systemMessage", (...args) => console.dir({ name: "systemMessage", args }, { depth: null }));
client.on("systemMessageRaw", (...args) => console.dir({ name: "systemMessageRaw", args }, { depth: null }));
client.on("actionBar", (...args) => console.dir({ name: "actionBar", args }, { depth: null }));
client.on("actionBarRaw", (...args) => console.dir({ name: "actionBarRaw", args }, { depth: null }));
client.on("message", (message) => {
    if (!message.content.startsWith("_")) return;
    const args = message.content.slice(1).split(" ");
    switch (args[0]) {
        case "w": client.held(MoveDirection.Forward); break;
        case "sw": client.release(MoveDirection.Forward); break;
        case "ws":
            client.held(MoveDirection.Forward);
            setTimeout(() => client.disconnect(), 2000);
            break;
        case "s": client.held(MoveDirection.Backward); break;
        case "ss": client.release(MoveDirection.Backward); break;
        case "a": client.held(MoveDirection.Left); break;
        case "sa": client.release(MoveDirection.Left); break;
        case "d": client.held(MoveDirection.Right); break;
        case "sd": client.release(MoveDirection.Right); break;
        case "stop": client.stopMoving(); break;

        case "at": {
            const [, x, y, z] = args.map(val => parseInt(val)) as [any, number, number, number];
            const state = client.at(x, y, z);
            // console.log(state);
            break;
        }

        case "disconnect":
        case "exit": 
            client.disconnect();
            break;
    }
});