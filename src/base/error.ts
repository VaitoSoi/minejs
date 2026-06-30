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

export class StringSizeExceedLimit extends Error {
    constructor() {
        super("read string size is exceed buffer limit");
    }
}

export class InvalidValue extends Error {
    constructor(public type: string, public got: string) {
        super(`got invalid value for ${type}: ${got}`);
    }
}

export class SockerIsNotWritable extends Error {
    constructor() {
        super("socket is not writable, do you connect it before?");
    }
}

export class CantGetMsAuthToken extends Error {
    constructor() {
        super("can't get microsoft auth token, maybe the responding request is invalid");
    }
}

export class CantGetMsAccessToken extends Error {
    constructor() {
        super("can't get microsoft access token");
    }
}

export class AuthError extends Error {
    constructor(public error: string) {
        super(`got oauth error: ${error}, for more info: https://datatracker.ietf.org/doc/html/rfc6749#section-5.2`);
    }
}

export class XboxError extends Error {
    constructor(public code: string) {
        super(`xbox error code: ${code}`);
    }
}

export class ProfileNotFound extends Error {
    constructor() {
        super("cant find your minecraft profile, do you own minecraft or set up the profile?");
    }
}

export class ProfileError extends Error {
    constructor(public code: string, public message: string) {
        super(`profile error: ${code}: ${message}`);
    }
}

export class AuthDenied extends Error {
    constructor() {
        super("the authorization request was denied");
    }
}

export class AuthTokenExpired extends Error {
    constructor() {
        super("device token is expired, please try again");
    }
}

export class MissingAuthOption extends Error {
    constructor() {
        super("you need to provide auth option to be able to play in premium server");
    }
}

export class RegistryItemNotFound extends Error {
    constructor(public item: string) {
        super(`cant find registry item: ${item}`);
    }
}

export class ClientNotReady extends Error {
    constructor() {
        super(`client is not ready`);
    }
}