import { Input, Client, ClientEvents } from "../../src/index";

const client = new Client({
    playerName: "bot",
    host: "localhost",
    port: 25565,
    version: "26.2",
    debug: {
        packetLogger: true,
        ignorePackets: [
            "move_entity_pos", "move_entity_pos_rot", "move_entity_rot",
            "set_entity_motion", "rotate_head", "set_time",
            "add_entity", "remove_entities", "bundle_delimiter",
            "entity_position_sync", "update_attributes",
            "move_player_pos", "move_player_pos_rot", "move_player_rot",
            "player_chat", "keep_alive", "entity_event", "tab_list"
        ],
        ignoreTCPPacketLogs: [0, 83, 54, 101, 1, 99, 53, 35, 131, 113, 102, 44, 56, 65, 34, 77, 122]
    },
    loadRegistry: false,
    // auth: {
    //     client_id: "d86254d8-edf7-4640-90eb-643c99af188e",
    //     method: "loopback",
    //     openBrowser: true,
    //     port: 12345
    // },
    // shouldVerifyMessageOrder: true,
    // shouldVerifyMessageSignature: true
    loadAndCacheChunk: false
});
const forwardEventToConsole = <K extends keyof ClientEvents>(name: K) => client.on(name, ((...args: any[]) => console.dir({ name, args }, { depth: null })) as any);
client.connect();
forwardEventToConsole("disconnect");
forwardEventToConsole("disconnectRaw");
// forwardEventToConsole("loadChunk");
// forwardEventToConsole("unloadChunk");
// forwardEventToConsole("spawnEntity");
// forwardEventToConsole("updateEntity");
// forwardEventToConsole("removeEntity");
// forwardEventToConsole("playerPosition");
// forwardEventToConsole("message");
forwardEventToConsole("systemMessage");
forwardEventToConsole("systemMessageRaw");
forwardEventToConsole("actionBar");
forwardEventToConsole("actionBarRaw");
forwardEventToConsole("openContainer");
forwardEventToConsole("closeContainer");
forwardEventToConsole("containerContent");
forwardEventToConsole("containerProperty");
forwardEventToConsole("tablist");

client.on("message", async (message) => {
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
            if (state) {
                console.dir(state);
                client.chat(state!.owner.type);
            } else 
                client.chat("no block");
            break;
        }

        case "open": {
            const [, x, y, z] = args.map(val => parseInt(val)) as [any, number, number, number];
            const success = client.openBlock(x, y, z);
            if (success) client.chat("opening");
            else client.chat("failed");
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