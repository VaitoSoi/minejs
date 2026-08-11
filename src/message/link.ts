export class MessageLink {
    constructor (
        public index: number,
        public sender: string,
        public session: string
    ) { }

    public static root(sender: string, session: string) {
        return new MessageLink(0, sender, session);
    }

    public static unsinged(sender: string) { return this.root(sender, "null"); }

    public isDescendantOf(link: MessageLink) {
        return link.index > this.index && this.sender === link.sender && this.session === link.session;
    }
}