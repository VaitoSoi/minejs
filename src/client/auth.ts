import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { AuthDenied, AuthError, AuthTokenExpired, CantGetMsAccessToken, ProfileError, ProfileNotFound, XboxError } from "../base/error";

interface Loopback {
    /**
     * This method will provide you a url to click on and do the authentication.
     * 
     * This will require an opening port in order to receive the response from Microsoft. If you cant, considering using `device_code` method.
     */
    method: "loopback",

    /**
     * The opening port for listening the response
     */
    port: number

    /**
     * Automatedly open browser or print a URL to click on.
     */
    openBrowser: boolean,
}

interface DeviceCode {
    /**
     * This method will provide you a device code, then you have to type this code in the given URL.
     */
    method: "device_code",
}

export type AuthOption = (Loopback | DeviceCode) & {
    /**
     * The Client ID
     * 
     * Get it by creating Microsoft Azure application
     */
    client_id: string,

    /**
     * Custom logger, default to `console.log`
     */
    log?: (message: string) => void;
}
// From assets dir
const ErrorHTML = `
<!DOCTYPE html>
<html>
    <head>
        <title>MineJS</title>
        <style>
            p { margin: 0; }
        </style>
    </head>
    <body>
        <div style="display: flex; height: 100vh; width: 100vw;">
            <div style="margin: auto; display: flex; flex-direction: column; text-align: center">
                <p style="font-size: 30px">An error is occurred while MineJS trying to get the token</p>
                <p style="font-size: 35px; color: crimson">{error}</p>
                <p style="font-size: 28px">{error_description}</p>
            </div>
        </div>
    </body>
</html>
`;
const SuccessHTML = `
<!DOCTYPE html>
<html>
    <head>
        <title>MineJS</title>
        <style>
            p { margin: 0; }
        </style>
    </head>
    <body>
        <div style="display: flex; height: 100vh; width: 100vw;">
            <div style="margin: auto; display: flex; flex-direction: column; text-align: center">
                <p style="font-size: 40px; font-weight: bold; color: darkcyan;">Done!</p>
                <p style="font-size: 30px;">You can close this tab</p>
            </div>
        </div>
    </body>
</html>
`;
const InvalidHTML = `
<!DOCTYPE html>
<html>
    <head>
        <title>MineJS</title>
        <style>
            p { margin: 0; }
        </style>
    </head>
    <body>
        <div style="display: flex; height: 100vh; width: 100vw;">
            <div style="margin: auto; display: flex; flex-direction: column; text-align: center">
                <p style="font-size: 35px; color: crimson">Invalid request >:&lpar;</p>
                <p style="font-size: 30px; color: crimson">{reason}</p>
            </div>
        </div>
    </body>
</html>
`;

function open(url: string, log: (message: string) => any) {
    // From https://stackoverflow.com/a/49013356/17106809
    switch (process.platform) {
        case "linux": exec(`xdg-open "${url}"`); break;
        case "win32": exec(`start "${url}"`); break;
        case "darwin": exec(`open "${url}"`); break;
        default:
            log(`${process.platform} is not supported`);
            log(`please open this url in your browser: ${url}`);
            break;
    }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Auth client, for authenticating Microsoft account
 */
export class AuthClient {
    private readonly codeVerifier: string;
    private readonly codeChallenge: string;
    // private refreshToken?: string;
    private accessToken: string = "";
    private uuid: string = "";

    constructor(private option: AuthOption) {
        const codeVerifier = crypto.randomBytes(32).toString("hex");
        const hashed = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
        this.option.log ||= console.log;

        this.codeVerifier = codeVerifier;
        this.codeChallenge = hashed;
    }



    /**
     * Get player UUID
     */
    public async getUUID() {
        if (this.option.method === "loopback") return this.loopback();
        else return this.deviceCode();
    }

    private async loopback() {
        const option = this.option as Loopback;
        const expectState = crypto.randomBytes(8).toString("hex");
        const authUrl = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
        authUrl.searchParams.append("client_id", this.option.client_id);
        authUrl.searchParams.append("response_type", "code");
        authUrl.searchParams.append("redirect_uri", `http://localhost:${option.port}`);
        authUrl.searchParams.append("scope", "XboxLive.signin offline_access");
        authUrl.searchParams.append("code_challenge", this.codeChallenge);
        authUrl.searchParams.append("code_challenge_method", "S256");
        authUrl.searchParams.append("state", expectState);

        if (option.openBrowser === true)
            open(authUrl.toString(), this.option.log!);
        else
            this.option.log!(`please open this url in your browser: ${authUrl.toString()}`);

        const msAuthToken = await new Promise<string | null>((resolve) => {
            const server = http.createServer((req, res) => {
                const end = (html: string, result: any = null) => {
                    if (res.writable)
                        res.end(html);
                    if (server.listening) {
                        server.close();
                        return resolve(result);
                    }
                };

                const url = new URL(req.url || "", `http://localhost:${option.port}`);
                const error = url.searchParams.get("error");
                if (error) {
                    const description = url.searchParams.get("error_description")!;
                    return end(ErrorHTML.replace("{error}", error).replace("{error_description}", description));
                }

                const code = url.searchParams.get("code");
                if (!code)
                    return end(InvalidHTML.replace("{reason}", "Missing <code>code</code> parameter"));

                const state = url.searchParams.get("state");
                if (!state)
                    return end(InvalidHTML.replace("{reason}", "Missing <code>state</code> parameter"));
                if (state !== expectState)
                    return end(InvalidHTML.replace("{reason}", "Mismatch state"));

                return end(SuccessHTML, code);
            });

            server.listen(option.port);
        });

        if (!msAuthToken)
            throw new CantGetMsAccessToken();

        const msTokenUrl = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/token");
        const msTokenBody = new URLSearchParams();
        msTokenBody.append("client_id", this.option.client_id);
        msTokenBody.append("scope", "XboxLive.signin offline_access");
        msTokenBody.append("code", msAuthToken);
        msTokenBody.append("redirect_uri", `http://localhost:${option.port}`);
        msTokenBody.append("grant_type", "authorization_code");
        msTokenBody.append("code_verifier", this.codeVerifier);
        const msTokenRequest = await fetch(msTokenUrl, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            body: msTokenBody.toString()
        });
        const msTokenResponse = await getJson(msTokenRequest, "microsoft token request") as Record<string, any>;
        if ("error" in msTokenResponse)
            throw new OAuthError(msTokenResponse["error"]);
        const msToken = msTokenResponse["access_token"];

        return this.getMcToken(msToken);
    }

    private async deviceCode() {
        const codeUrl = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode");
        const codeBody = new URLSearchParams();
        codeBody.set("client_id", this.option.client_id);
        codeBody.append("scope", "XboxLive.signin offline_access");

        const codeRequest = await fetch(codeUrl, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            body: codeBody.toString()
        });
        const codeResponse = await codeRequest.json() as Record<string, any>;
        const deviceCode = codeResponse["device_code"];
        const message = codeResponse["message"];
        let interval = Number(codeResponse["interval"]);

        this.option.log!(message);

        let msToken;
        const msTokenUrl = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/token");
        const msTokenBody = new URLSearchParams();
        msTokenBody.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
        msTokenBody.set("client_id", this.option.client_id);
        msTokenBody.set("device_code", deviceCode);
        while (true) {
            await sleep(interval * 1000);
            const msTokenRequest = await fetch(msTokenUrl, {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                method: "POST",
                body: msTokenBody.toString()
            });
            const msTokenResponse = await msTokenRequest.json() as Record<string, any>;
            if ("error" in msTokenResponse)
                switch (msTokenResponse["error"]) {
                    case "authorization_pending": continue;
                    case "slow_down": interval += 5; continue;
                    case "auth_denied": throw new AuthDenied();
                    case "expired_token": throw new AuthTokenExpired();
                    default: throw new OAuthError(msTokenResponse["error"]);
                }
            else {
                msToken = msTokenResponse["access_token"];
                break;
            }
        }

        if (!msToken)
            throw new CantGetMsAccessToken();

        return this.getMcToken(msToken);
    }

    private async getMcToken(msToken: string): Promise<{
        uuid: string,
        name: string
    }> {
        // Get Xbox Live token
        const xboxRequest = await fetch("https://user.auth.xboxlive.com/user/authenticate", {
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                "Properties": {
                    "AuthMethod": "RPS",
                    "SiteName": "user.auth.xboxlive.com",
                    "RpsTicket": `d=${msToken}`
                },
                "RelyingParty": "http://auth.xboxlive.com",
                "TokenType": "JWT"
            }),
            method: "POST"
        });
        const xboxReponse = await getJson(xboxRequest, "xbox request") as Record<string, any>;
        const xboxToken = xboxReponse["Token"];
        const userHash = xboxReponse["DisplayClaims"]["xui"][0]["uhs"];

        const xboxSecurityRequest = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                "Properties": {
                    "SandboxId": "RETAIL",
                    "UserTokens": [xboxToken]
                },
                "RelyingParty": "rp://api.minecraftservices.com/",
                "TokenType": "JWT"
            }),
            method: "POST"
        });
        const xboxSecurityReponse = await getJson(xboxSecurityRequest, "xbox security request") as Record<string, any>;
        if ("XErr" in xboxSecurityReponse)
            throw new XboxError(xboxSecurityReponse["XErr"]);
        const xboxSecurityToken = xboxSecurityReponse["Token"];

        const minecraftRequest = await fetch("https://api.minecraftservices.com/authentication/login_with_xbox", {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                "identityToken": `XBL3.0 x=${userHash};${xboxSecurityToken}"`
            }),
            method: "POST"
        });
        const minecraftResponse = await getJson(minecraftRequest, "minecraft request") as Record<string, any>;
        const minecraftToken = minecraftResponse["access_token"];

        const mcProfileRequest = await fetch("https://api.minecraftservices.com/minecraft/profile", {
            headers: {
                "Authorization": `Bearer ${minecraftToken}`
            },
            method: "GET"
        });
        const mcProfileResponse = await getJson(mcProfileRequest, "minecraft profile request") as Record<string, any>;
        if ("error" in mcProfileResponse) {
            if (mcProfileResponse["error"] === "NOT_FOUND")
                throw new ProfileNotFound();
            else throw new ProfileError(mcProfileResponse["error"], mcProfileResponse["errorMessage"]);
        }

        this.accessToken = minecraftToken;
        this.uuid = mcProfileResponse["id"];
        return {
            uuid: mcProfileResponse["id"],
            name: mcProfileResponse["name"]
        };
    }
}