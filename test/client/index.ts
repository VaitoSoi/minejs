import { Input, Client } from "../../src/index";

const client = new Client({
    playerName: "bot",
    host: "localhost",
    port: 25565,
    version: "26.2",
    // debug: {
    //     packetLogger: true
    // },
    loadRegistry: false,
    // auth: {
    //     client_id: "d86254d8-edf7-4640-90eb-643c99af188e",
    //     method: "loopback",
    //     openBrowser: true,
    //     port: 12345
    // },
    // shouldVerifyMessageOrder: true,
    // shouldVerifyMessageSignature: true
    loadAndCacheChunk: true
});
client.connect();
client.on("disconnect", (...args) => console.dir({ name: "disconnect", args }, { depth: null }));
client.on("disconnectRaw", (...args) => console.dir({ name: "disconnectRaw", args }, { depth: null }));
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
        case "w": client.hold(Input.Forward); break;
        case "sw": client.release(Input.Forward); break;
        case "ws":
            client.hold(Input.Forward);
            setTimeout(() => client.disconnect(), 2000);
            break;
        case "s": client.hold(Input.Backward); break;
        case "ss": client.release(Input.Backward); break;
        case "a": client.hold(Input.Left); break;
        case "sa": client.release(Input.Left); break;
        case "d": client.hold(Input.Right); break;
        case "sd": client.release(Input.Right); break;
        case "j": client.hold(Input.Jump); break;
        case "sj": client.release(Input.Jump); break;
        case "run": client.hold(Input.Sprint); break;
        case "srun": client.release(Input.Sprint); break;
        case "stop": client.stopMoving(); break;

        case "at": {
            const [, x, y, z] = args.map(val => parseInt(val)) as [any, number, number, number];
            console.time("get_block");
            const state = client.at(x, y, z);
            console.timeEnd("get_block");
            console.log(state);
            break;
        }

        case "e":
        case "echo":
        case "say": {
            const message = args.slice(1).join(" ");
            client.chat(message);
            break;
        }

        case "disconnect":
        case "exit":
            client.disconnect();
            break;
    }
});