/** @hidden */
export class ClientNotReady extends Error {
    constructor() {
        super(`client is not ready`);
    }
}

/** @hidden */
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

/** @hidden */
export class NumberTooBig extends Error {
    constructor(public number: number | bigint) {
        super("provided number is exceeded system limit (64 bits or 8 byte), got " + number.toString());
    }
}

/** @hidden */
export class StringSizeExceedLimit extends Error {
    constructor() {
        super("read string size is exceed buffer limit");
    }
}

/** @hidden */
export class InvalidValue extends Error {
    constructor(public type: string, public got: string) {
        super(`got invalid value for ${type}: ${got}`);
    }
}

/*
 * TCP connection
 */

/** @hidden */
export class SockerIsNotWritable extends Error {
    constructor() {
        super("socket is not writable, do you connect it before?");
    }
}

/*
 * Authenticating... 
 */

/** @hidden */
export class CantGetMsAuthToken extends Error {
    constructor() {
        super("can't get microsoft auth token, maybe the responding request is invalid");
    }
}

/** @hidden */
export class CantGetMsAccessToken extends Error {
    constructor() {
        super("can't get microsoft access token");
    }
}

/** @hidden */
export class OAuthError extends Error {
    constructor(public error: string, public detail?: any) {
        super(`got oauth error: ${error}, for more info: https://datatracker.ietf.org/doc/html/rfc6749#section-5.2`);
    }
}

/** @hidden */
export class AuthClientError extends Error {
    constructor(public error: string, public detail?: any) {
        super(error, detail);
    }
}

/** @hidden */
export class XboxError extends Error {
    constructor(public code: string) {
        super(`xbox error code: ${code}`);
    }
}

/** @hidden */
export class MinecraftError extends Error {
    constructor(public error: string) {
        super(`minecraft auth error: ${error}`);
    }
}
/** @hidden */
export class ProfileNotFound extends Error {
    constructor() {
        super("cant find your minecraft profile, do you own minecraft or set up the profile?");
    }
}

/** @hidden */
export class ProfileError extends Error {
    constructor(public code: string, public message: string) {
        super(`profile error: ${code}: ${message}`);
    }
}

/** @hidden */
export class AuthDenied extends Error {
    constructor() {
        super("the authorization request was denied");
    }
}

/** @hidden */
export class AuthTokenExpired extends Error {
    constructor() {
        super("device token is expired, please try again");
    }
}

/** @hidden */
export class MissingAuthOption extends Error {
    constructor() {
        super("you need to provide auth option to be able to play in premium server");
    }
}

export class AuthRelatedNotFound extends Error {
    constructor(public component: string) {
        super(`auth option is enabled, but the auth related component (${component}) is not found`);
    }
}

/*
 * Packets
 */

/** @hidden */
export class RegistryItemNotFound extends Error {
    constructor(public item: string) {
        super(`cant find registry item: ${item}`);
    }
}
/** @hidden */
export class VersionNotSupport extends Error {
    constructor(public version: string) {
        super(`version ${version} is not supported`);
    }
}

/** @hidden */
export class CantReadFile extends Error {
    constructor(public path: string) {
        super(`can't read file at "${path}"`);
    }
}

/** @hidden */
export class InvalidPacketStructure extends Error {
    constructor(public path: string, public zodIssue?: any[]) {
        super(`packet structure in file "${path}" is invalid` + (zodIssue?.length ? ", zod issue: " + JSON.stringify(zodIssue, null, 4) : ""));
    }
}


/** @hidden */
export class MissingPacketField extends Error {
    constructor(public packetId: number, public field: string, public need: string) {
        super(`${packetId}: ${field} need ${need}, but not found`);
    }
}

/** @hidden */
export class MissingField extends Error {
    constructor(public field: string, public where: string) {
        super(`missing ${field} in ${where}`);
    }
}

/** @hidden */
export class NotImplemented extends Error {
    constructor() {
        super("if you are dev, please create an issue on github. if you are vaito, hey, this function is not injected >:(");
    }
}

/*
 * Messages
 */

export class MessageLinkNotFound extends Error {
    constructor(public senderUUID: string) {
        super(`message link of sender ${senderUUID} not found, maybe because server has sent out of order packet`);
    }
}

export class HaveSignatureButNotIndex extends Error {
    constructor() {
        super (`expecting both shouldVerifyMessageOrder set to true when shouldVerifyMessageSignature set to true`);
    }
}