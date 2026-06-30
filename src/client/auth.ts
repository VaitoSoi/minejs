import http from "node:http";
import cryto from "node:crypto";
import net from "node:net";
import { exec } from "node:child_process";
import { AuthDenied, AuthError, AuthTokenExpired, CantGetMsAccessToken, ProfileError, ProfileNotFound, XboxError } from "../base/error";

export interface AuthOption {
    /**
     * `"loopback"` - open a browser to login
     * `"device_code"` - provide a device code to login
     */
    method: "loopback" | "device_code",

    /**
     * Automatedly open browser or print a URL to click on.
     */
    openBrowser: boolean,

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

// Got this from https://github.com/sindresorhus/get-port/blob/main/index.js#L47
const getFreePort = () => new Promise<number>((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
        const port = (server.address() as net.AddressInfo).port;
        server.close(() =>
            resolve(port)
        );
    });
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class AuthClient {
    private readonly codeVerifier: string;
    private readonly codeChallenge: string;
    // private refreshToken?: string;

    constructor(private option: AuthOption) {
        const codeVerifier = cryto.randomBytes(32).toString("hex");
        const hashed = cryto.hash("sha256", codeVerifier, "base64url");
        this.option.log ||= console.log;

        this.codeVerifier = codeVerifier;
        this.codeChallenge = hashed;
    }

    public async auth() {
        if (this.option.method === "loopback") return this.loopback();
        else return this.deviceCode();
    }

    private async loopback() {
        const freePort = await getFreePort();
        const expectState = cryto.randomBytes(8).toString("hex");
        const authUrl = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
        authUrl.searchParams.append("client_id", this.option.client_id);
        authUrl.searchParams.append("response_type", "code");
        authUrl.searchParams.append("redirect_uri", `http://127.0.0.1:${freePort}`);
        authUrl.searchParams.append("scope", "XboxLive.signin offline_access");
        authUrl.searchParams.append("code_challenge", this.codeChallenge);
        authUrl.searchParams.append("code_challenge_method", "S256");
        authUrl.searchParams.append("state", expectState);

        if (this.option.openBrowser === true)
            open(authUrl.toString(), this.option.log!);
        else
            this.option.log!(`please open this url in your browser: ${authUrl.toString()}`);

        const msAuthToken = await new Promise<string | null>((resolve) => {
            const server = http.createServer((req, res) => {
                const end = (html: string, result: any = null) => {
                    res.end(html);
                    server.close();
                    return resolve(result);
                };

                const url = new URL(req.url || "", `http://127.0.0.1:${freePort}`);
                const error = url.searchParams.get("error");
                if (error) {
                    const description = url.searchParams.get("error_description")!;
                    end(ErrorHTML.replace("{error}", error).replace("{error_description}", description));
                }

                const code = url.searchParams.get("code");
                if (!code)
                    end(InvalidHTML.replace("{reason}", "Missing <code>code</code> parameter"));

                const state = url.searchParams.get("state");
                if (!state)
                    end(InvalidHTML.replace("{reason}", "Missing <code>state</code> parameter"));
                if (state !== expectState)
                    end(InvalidHTML.replace("{reason}", "Mismatch state"));

                return end(SuccessHTML, code);
            });

            server.listen(freePort);
        });

        if (!msAuthToken)
            throw new CantGetMsAccessToken();

        const msTokenUrl = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/token");
        const msTokenBody = new URLSearchParams();
        msTokenBody.append("client_id", this.option.client_id);
        msTokenBody.append("code", msAuthToken);
        msTokenBody.append("scope", "XboxLive.signin offline_access");
        msTokenBody.append("redirect_uri", `http://127.0.0.1:${freePort}`);
        msTokenBody.append("grant_type", "authorization_code");
        msTokenBody.append("code_verifier", this.codeVerifier);
        const msTokenRequest = await fetch(msTokenUrl, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            body: msTokenBody.toString()
        });
        const msTokenResponse = await msTokenRequest.json() as Record<string, any>;
        if ("error" in msTokenResponse)
            throw new AuthError(msTokenResponse["error"]);
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
        const msTokenUrl = new URL("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token");
        const msTokenBody = new URLSearchParams();
        msTokenBody.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
        msTokenBody.set("client_id", this.option.client_id);
        msTokenBody.set("device_code", deviceCode);
        while (true) {
            await sleep(interval * 1000);
            const msTokenRequest = await fetch(msTokenUrl, {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                method: "POST"
            });
            const msTokenResponse = await msTokenRequest.json() as Record<string, any>;
            if ("error" in msTokenResponse)
                switch (msTokenResponse["error"]) {
                    case "authorization_pending": continue;
                    case "slow_down": interval += 5; continue;
                    case "auth_denied": throw new AuthDenied();
                    case "expired_token": throw new AuthTokenExpired();
                    default: throw new AuthError(msTokenResponse["error"]);
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
        token: string,
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
        const xboxReponse = await xboxRequest.json() as Record<string, any>;
        const xboxToken = xboxReponse["Token"];
        const userHash = xboxReponse["DisplayClaims"]["xui"][0]["uhs"];

        const xboxSecurityRequest = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
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
        const xboxSecurityReponse = await xboxSecurityRequest.json() as Record<string, any>;
        if ("XErr" in xboxSecurityReponse)
            throw new XboxError(xboxSecurityReponse["XErr"]);
        const xboxSecurityToken = xboxSecurityReponse["Token"];

        const minecraftRequest = await fetch("https://api.minecraftservices.com/authentication/login_with_xbox", {
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                "identityToken": `XBL3.0 x=${userHash};${xboxSecurityToken}"`
            }),
            method: "POST"
        });
        const minecraftResponse = await minecraftRequest.json() as Record<string, any>;
        const minecraftToken = minecraftResponse["access_token"];

        const mcProfileRequest = await fetch("https://api.minecraftservices.com/minecraft/profile", {
            headers: {
                "Authorization": `Bearer ${minecraftToken}`
            },
            method: "GET"
        });
        const mcProfileResponse = await mcProfileRequest.json() as Record<string, any>;
        if ("error" in mcProfileResponse) {
            if (mcProfileResponse["error"] === "NOT_FOUND")
                throw new ProfileNotFound();
            else throw new ProfileError(mcProfileResponse["error"], mcProfileResponse["errorMessage"]);
        }

        return {
            token: minecraftToken,
            uuid: mcProfileResponse["id"],
            name: mcProfileResponse["name"]
        };
    }
}