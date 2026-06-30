// Simpler version of https://github.com/andywer/typed-emitter
export interface TypedEmmiter<Events extends object> {
    on: <K extends keyof Events>(event: K, func: Events[K] extends any[] ? (...args: Events[K]) => void : never) => void,
    once: <K extends keyof Events>(event: K, func: Events[K] extends any[] ? (...args: Events[K]) => void : never) => void,
    emit: <K extends keyof Events>(event: K, ...args: Events[K] extends any[] ? Events[K] : never) => void,
}