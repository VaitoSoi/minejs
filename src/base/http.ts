import { AuthClientError } from "./error";

export async function getJson(res: Response, source: string) {
    const data = await res.text();
    try {
        return JSON.parse(data);
    } catch (e) {
        throw new AuthClientError(`cant parse json from ${source}`, data);
    }
}