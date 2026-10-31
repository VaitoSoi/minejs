import { Input, Client, ClientEvents, Button, PaintingMode } from "../../src/index";

const version = process!.argv[2];
if (!version) {
    throw new Error("missing version, run `tsx test/client <version>`");
}

const client = new Client({
    playerName: "bot",
    host: "localhost",
    port: 25565,
    version,
    debug: {
        packetLogger: true,
        ignorePackets: [
            "move_entity_pos", "move_entity_pos_rot", "move_entity_rot",
            "set_entity_motion", "rotate_head", "set_time",
            "add_entity", "remove_entities", "bundle_delimiter",
            "entity_position_sync", "update_attributes",
            "move_player_pos", "move_player_pos_rot", "move_player_rot",
            "player_chat", "keep_alive", "entity_event", "tab_list",
            "block_event", "client_tick_end"
        ],
        ignoreTCPPacketLogs: [0, 83, 54, 101, 1, 99, 53, 35, 131, 113, 102, 44, 56, 65, 34, 77, 122, 7, 85, 134, 104, 55, 115, 78, 103]
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
client.once("ready", () => console.log("Ready :D"));
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
forwardEventToConsole("blockUpdate");
forwardEventToConsole("orphanBlockUpdate");

let paint: PaintingMode | undefined = undefined;
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
            const state = client.getBlock(x, y, z);
            console.timeEnd("get_block");
            if (state) {
                console.dir(state);
                client.chat(state!.owner.type);
            } else
                client.chat("no block");
            break;
        }

        case "open": {
            const [, x, y, z] = args.map(val => Number(val)) as [any, number, number, number];
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

        case "pos": {
            const { x, y, z } = client.getPosition();
            client.chat(`XYZ: ${x} ${y} ${z}`);
            break;
        }

        case "slot": {
            const container = client.getOpeningContainer();
            if (!container)
                return client.chat("Not open any :(");
            console.dir(container, { depth: null });
            break;
        }

        case "click": {
            const container = client.getOpeningContainer();
            if (!container)
                return client.chat("Not open any :(");

            const slot = Number(args[2]);
            if (isNaN(slot))
                return client.chat("Slot has to be a number");

            switch (args[1]) {
                case "0": container.click(slot, Button.LeftMouse); break;
                case "1": container.click(slot, Button.RightMouse); break;
                default: return client.chat("0 for left, 1 for right");
            }
            client.chat("Done!");
            break;
        }

        case "paint": {
            const container = client.getOpeningContainer();
            if (!container)
                return client.chat("Not open any :(");

            switch (args[1]) {
                case "start": {
                    switch (args[2]) {
                        case "0": paint = container.paint(Button.LeftMouse); break;
                        case "1": paint = container.paint(Button.RightMouse); break;
                        default: return client.chat("0 for left, 1 for right");
                    }

                    client.chat("Started!");
                    break;
                }

                case "select": {
                    if (!paint)
                        return client.chat("Not painting :(");

                    const slot = Number(args[2]);
                    if (isNaN(slot))
                        return client.chat("Slot has to be a number");

                    paint.select(slot);
                    client.chat("Ok :D");
                    break;
                }


                case "done": {
                    if (!paint)
                        return client.chat("Not painting :(");
                    paint.done();
                    paint = undefined;
                    client.chat("Done");
                    break;
                }
            }
        }
    }
});