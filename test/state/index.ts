import { AxisCycle } from "../../src/physics/direction";
import { BlockRegistry } from "../../src/version/registry";

BlockRegistry.load("26.2").then(() => {
    const shape = BlockRegistry.getState("10").shape;
    console.dir(shape);
});