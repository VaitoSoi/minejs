<div style="width: 100%; display: flex">
    <img src="./assets/doc/banner.png" style="height: 20rem; margin: auto" alt="MineJS ugly banner"/>
</div>

## I. Introduction

This is a Minecraft client package, written entirely in Typescript, using NodeJS `node:net` to communicate with Minecraft server. Currently support 1.21.10 and planned to support 26.2.

### DISCLAIMER

This package is highly unstable for now, please report if there is any bug, glitch.

## II. Usage

Install MineJS using your favorite package manager:

```bash
npm install @vaitosoi/minejs
```

Then write a simple code like this:

```typescript
// index.ts
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
    //     client_id: "<Your Azure app's client_id>",
    //     method: "loopback",
    //     openBrowser: true
    // }
});
client.connect();
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
```

And run it:

```
npm tsx index.ts
```


## III. Note:

If you are Vaito: Stop being a lazy a$$ and implement new update, here is the link: https://minecraft.wiki/?title=Java_Edition_protocol%2FPackets&diff=3675033&oldid=3445844