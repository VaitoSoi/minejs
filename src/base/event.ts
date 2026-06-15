import { EventEmitterOptions } from "node:events";

// Simpler version of https://github.com/andywer/typed-emitter
export interface TypedEmmiter<Events extends object> {
    on: <K extends keyof Events>(event: K, ...args: Events[K] extends any[] ? Events[K] : never) => void,
    once: <K extends keyof Events>(event: K, ...args: Events[K] extends any[] ? Events[K] : never) => void,
    emit: <K extends keyof Events>(event: K, ...args: Events[K] extends any[] ? Events[K] : never) => void,
}