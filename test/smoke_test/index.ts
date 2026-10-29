import { Client } from "../../src/";

const {
    VERSION,
    NAME,
    HOST,
    PORT,
    STAY_SECOND
} = process.env;

if (
    !VERSION ||
    !NAME ||
    !HOST || isNaN(PORT as any) ||
    !PORT ||
    !STAY_SECOND || isNaN(STAY_SECOND as any)
) {
    throw new Error("missing envs");
}

const client = new Client({
    host: HOST,
    port: Number(PORT),
    playerName: NAME,
    version: VERSION
});
client.once("ready", () => {
    console.log("Ready");
    setTimeout(() => {
        console.log("Disconnecting...");
        client.disconnect();
    }, parseInt(STAY_SECOND) * 1000);
});
client.connect();