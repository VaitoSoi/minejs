export class UnexpectedValue extends Error {
    constructor(
        public type: string,
        public got: string,
        public expect?: string
    ) {
        if (expect)
            super(`unexpected value of ${type}, expect ${expect}, got ${got}`);
        else
            super(`unexpected value of ${type}: ${got}`);
    }
}

export class NumberTooBig extends Error {
    constructor(public number: number | bigint) {
        super("provided number is exceeded system limit (64 bits or 8 byte), got " + number.toString());
    }
}

export class InvalidValue extends Error {
    constructor (public type: string, public got: string) {
        super(`got invalid value for ${type}: ${got}`);
    }
}