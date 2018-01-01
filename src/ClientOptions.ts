const version = require("../package.json").version;

export class ClientOptions {
    public token: string;
    public userAgent: string = `DiscordApiClient (https://github.com/aequasi/discord-api-client, ${version})`;
    public initialThreshold: number = 5;
    public startBlocked: boolean = false;
    public latencyThreshold = 4000;
    public requestTimeout: number = 15000;
    public maximumAttempts: number = 5;
    public retryTime: number = Math.floor(Math.random() * 1900 + 100);
}
