export class SignatureCache {
    private entries: Buffer[];

    constructor(public capacity: number) {
        this.entries = Array.from({ length: this.capacity });
    }

    public static default() { return new SignatureCache(128); }

    public get(index: number) { return this.entries[index]; }

    public unpack = (messages: { message_id: number, signature?: number[] | undefined }[]) => 
        messages.map(({ message_id: id, signature }) => signature ? Buffer.from(signature) : this.get(id)!);

    public push(input: Buffer[]) {
        const queue = input.slice();
        const set = new Set(queue.map(v => v.toString("hex")));
        for (let i = 0; i < this.entries.length && queue.length > 0; i++) {
            const entry = !!this.entries[i] && Buffer.from(this.entries[i]!);
            this.entries[i] = queue.pop()!;
            if (entry && !set.has(entry.toString("hex")))
                queue.unshift(entry);
        }
    }
}