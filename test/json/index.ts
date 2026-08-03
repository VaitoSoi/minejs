import { PacketDefinitions } from "../../src/version/adapter";

console.dir(PacketDefinitions.toJSONSchema({ reused: "ref", target: "openapi-3.0" }), { depth: null });