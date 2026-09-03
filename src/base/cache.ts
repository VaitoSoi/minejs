/**
 * The base implementation for the Cache class
 */
export abstract class CacheImplementation<T = any> {
    public abstract put(key: string, item: T): void;
    public abstract get(key: string): T | undefined;
    public abstract del(key: string): void;
}

/**
 * The LRU cache implementation.
 * 
 * @see https://en.wikipedia.org/wiki/Cache_replacement_policies#Time-Aware,_Least_Recently_Used_(TLRU)
 */
export class LRUCache<T> extends CacheImplementation<T> {
    private hash: Map<string, T> = new Map();
    private list: string[] = [];

    constructor(private capacity: number) {
        super();
    }

    public put(key: string, item: T): void {
        if (this.hash.has(key)) {
            const oldIndex = this.list.indexOf(key);
            if (oldIndex > -1)
                this.list.splice(oldIndex, 1);
        }

        this.hash.set(key, item);
        this.list.push(key);

        this.truncateHash();
    }

    public get(key: string) {
        if (!this.hash.has(key)) return undefined;

        const item = this.hash.get(key);
        const oldIndex = this.list.indexOf(key);
        if (oldIndex > -1)
            this.list.splice(oldIndex, 1);
        this.list.push(key);
        
        return item;
    }

    public del(key: string): void {
        const oldIndex = this.list.indexOf(key);
        if (oldIndex > -1)
            this.list.splice(oldIndex, 1);
        this.hash.delete(key);
    }

    private truncateHash() {
        while (this.list.length > this.capacity) {
            const popping = this.list.pop();
            if (popping)
                this.hash.delete(popping);
        }
    }
}