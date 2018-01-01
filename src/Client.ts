import {ClientOptions} from "./ClientOptions";
import Bucket from "./Bucket";
import MultipartData from "./MultipartData";
import * as https from "https";
import {BASE_URL} from "./Constants";
import {EventEmitter} from "events";
import * as Zlib from "zlib";
import DiscordRESTError from "./Error/DiscordRESTError";
import DiscordHTTPError from "./Error/DiscordHTTPError";

export interface FileInterface {
    /**
     * What to name the file
     * @type {String}
     */
    name: string

    /**
     * A buffer containing file data
     * @type {String}
     */
    file: Buffer;
}

/**
 * API Client - Bunch of stuff taken from the Eris Discord Library.
 *
 * @see https://github.com/abalabahaha/eris/blob/master/lib/rest/RequestHandler.js
 */
export default class Client extends EventEmitter {
    public latencyReference = {
        latency: 500,
        raw: new Array(10).fill(500),
        timeOffset: 0,
        timeOffsets: new Array(10).fill(0),
        lastTimeOffsetCheck: 0
    };
    private options: ClientOptions;
    private blocked: boolean = false;
    private queue: Function[] = [];
    private buckets: { [route: string]: Bucket };

    constructor(options: Partial<ClientOptions>) {
        super();

        this.options = Object.assign(new ClientOptions(), options);
        if (this.options.startBlocked) {
            this.blocked = true;
        }
    }

    public unblock() {
        this.blocked = false;
        while (this.queue.length > 0) {
            this.queue.shift()();
        }
    }

    /**
     * Make a call to the Discord API
     *
     * @param {string} method HTTP Method
     * @param {string} url URL of the endpoint
     * @param {boolean} auth Whether to add the Authorization header and token or not
     * @param {Object} body Request payload
     * @param {FileInterface|FileInterface[]} file
     * @param {boolean} immediate Whether we should skip the queue or not
     *
     * @returns {Promise<Object>} Resolves with the returned JSON data
     */
    public async request(method: string, url: string, auth: boolean = true, body: any = undefined, file: FileInterface | FileInterface[] = undefined, route: string = undefined, immediate: boolean = false): Promise<any> {
        method = method.toUpperCase();
        route = route || Client.getRoute(method, url);
        const stackHolder: any = {};
        Error.captureStackTrace(stackHolder);

        return new Promise((resolve, reject) => {
            let attempts = 0;

            let finalURL;
            const actualCall = (callback) => {
                const headers: any = {"User-Agent": this.options.userAgent, "Accept-Encoding": "gzip,deflate"};
                let data;
                try {
                    if (auth) {
                        headers.Authorization = this.options.token;
                    }

                    // Add header for audit log reason, if its in the body
                    if (body && body.reason) {
                        if (body.reason === decodeURI(body.reason)) {
                            body.reason = encodeURIComponent(body.reason);
                        }
                        headers["X-Audit-Log-Reason"] = body.reason;
                        delete body.reason;
                    }

                    if (body && body.queryReason) {
                        body.reason = body.queryReason;
                        delete body.queryReason;
                    }

                    if (Object.keys(body).length === 0) {
                        body = undefined;
                    }

                    if (file !== undefined) {
                        if (!Array.isArray(file)) {
                            if (!file.file) {
                                throw new Error("Invalid file object");
                            }

                            file = [file];
                        }

                        data = new MultipartData();
                        headers["Content-Type"] = "multipart-form-data; boundary=" + data.boundary;
                        file.forEach((f) => {
                            if (!f.file) {
                                return;
                            }

                            data.attach(f.name, f.file, f.name);
                        });
                        if (body) {
                            data.attach("payload_json", body);
                        }
                        data.finish();
                    } else if (body) {
                        // Special PUT&POST case (╯°□°）╯︵ ┻━┻
                        if (method === "GET" || (method === "PUT" && url.includes("/bans/")) || (method === "POST" && url.includes("/prune"))) {
                            let qs = "";
                            Object.keys(body).forEach(function (key) {
                                if (body[key] != undefined) {
                                    if (Array.isArray(body[key])) {
                                        body[key].forEach(function (val) {
                                            qs += `&${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
                                        });
                                    } else {
                                        qs += `&${encodeURIComponent(key)}=${encodeURIComponent(body[key])}`;
                                    }
                                }
                            });
                            finalURL += "?" + qs.substring(1);
                        } else {
                            data = JSON.stringify(body);
                            headers["Content-Type"] = "application/json";
                        }
                    }
                } catch (error) {
                    callback(error);
                    reject(error);

                    return;
                }

                const request = https.request({method, headers, host: "discordapp.com", path: BASE_URL + finalURL});
                let requestError;
                request
                    .once("abort", () => {
                        callback();
                        requestError = requestError || new Error(`Request aborted by client on ${method} ${url}`);
                        reject(requestError);
                    })
                    .once("aborted", () => {
                        callback();
                        requestError = requestError || new Error(`Request aborted by server on ${method} ${url}`);
                        requestError.request = request;
                        reject(requestError);
                    })
                    .once("error", (error) => {
                        requestError = error;

                        request.abort();
                    });

                let latency = Date.now();
                request.once("response", (response) => {
                    latency = Date.now() - latency;
                    this.latencyReference.raw.push(latency);
                    this.latencyReference.latency = ~~(this.latencyReference.latency - this.latencyReference.raw.shift()/ 10 + latency / 10);

                    const headerNow = Date.parse(response.headers.date);
                    if (this.latencyReference.lastTimeOffsetCheck < Date.now() - 5000) {
                        let timeOffset = ~~((this.latencyReference.lastTimeOffsetCheck = Date.now()) - headerNow);
                        if (this.latencyReference.timeOffset - this.latencyReference.lastTimeOffsetCheck >= this.options.latencyThreshold && timeOffset - this.latencyReference.lastTimeOffsetCheck >= this.options.latencyThreshold) {
                            this.emit("warn", new Error(`Your clock is ${this.latencyReference.timeOffset}ms behind Discord's server clock. Please check your connection and system time.`));
                        }
                        this.latencyReference.timeOffset = ~~(this.latencyReference.timeOffset - this.latencyReference.timeOffsets.shift() / 10 + timeOffset / 10);
                        this.latencyReference.timeOffsets.push(timeOffset);
                    }

                    let responseString = "";
                    let responseStream = response;
                    if (response.headers["content-encoding"]) {
                        if (~response.headers["content-encoding"].indexOf("gzip")) {
                            responseStream = response.pipe(Zlib.createGunzip());
                        } else if (~response.headers["content-encoding"].indexOf("deflate")) {
                            responseStream = response.pipe(Zlib.createInflate());
                        }
                    }

                    responseStream
                        .on("data", (str) => response += str)
                        .once("end", () => {
                            let now = Date.now();
                            if (response.headers["x-ratelimit-limit"]) {
                                this.buckets[route].limit = +response.headers["x-ratelimit-limit"];
                            }

                            if (method !== "GET" && (response.headers["x-ratelimit-remaining"] == undefined || response.headers["x-ratelimit-limit"] == undefined) && this.buckets[route].limit !== 1) {
                                this.emit("warn", `Missing ratelimit headers for SequentialBucket(${this.buckets[route].remaining}/${this.buckets[route].limit}) with non-default limit\n`
                                    + `${response.statusCode} ${response.headers["content-type"]}: ${method} ${route} | ${response.headers["cf-ray"]}\n`
                                    + "content-type = " + +"\n"
                                    + "x-ratelimit-remaining = " + response.headers["x-ratelimit-remaining"] + "\n"
                                    + "x-ratelimit-limit = " + response.headers["x-ratelimit-limit"] + "\n"
                                    + "x-ratelimit-reset = " + response.headers["x-ratelimit-reset"] + "\n"
                                    + "x-ratelimit-global = " + response.headers["x-ratelimit-global"]);
                            }

                            this.buckets[route].remaining = response.headers["x-ratelimit-remaining"] === undefined ? 1 : +response.headers["x-ratelimit-remaining"] || 0;
                            if (response.headers["retry-after"]) {
                                if (response.headers["x-ratelimit-global"]) {
                                    this.blocked = true;
                                    setTimeout(() => this.unblock(), +response.headers["retry-after"] || 1);
                                } else {
                                    this.buckets[route].reset = (+response.headers["retry-after"] || 1) + now;
                                }
                            } else if (response.headers["x-ratelimit-reset"]) {
                                if ((~route.lastIndexOf("/reactions/:id")) && (+response.headers["x-ratelimit-reset"] * 1000 - headerNow) === 1000) {
                                    this.buckets[route].reset = Math.max(now + 250 - this.latencyReference.timeOffset, now);
                                } else {
                                    this.buckets[route].reset = Math.max(+response.headers["x-ratelimit-reset"] * 1000 - this.latencyReference.timeOffset, now);
                                }
                            } else {
                                this.buckets[route].reset = now;
                            }

                            if (response.statusCode !== 429) {
                                this.emit("debug", `${body && body.content} ${now} ${route} ${response.statusCode}: ${latency}ms (${this.latencyReference.latency}ms avg) | ${this.buckets[route].remaining}/${this.buckets[route].limit} left | Reset ${this.buckets[route].reset} (${this.buckets[route].reset - now}ms left)`);
                            }

                            if (response.statusCode >= 300) {
                                if (response.statusCode === 429) {
                                    this.emit("debug", `${response.headers["x-ratelimit-global"] ? "Global" : "Unexpected"} 429 (╯°□°）╯︵ ┻━┻: ${response}\n${body && body.content} ${now} ${route} ${response.statusCode}: ${latency}ms (${this.latencyReference.latency}ms avg) | ${this.buckets[route].remaining}/${this.buckets[route].limit} left | Reset ${this.buckets[route].reset} (${this.buckets[route].reset - now}ms left)`);
                                    if (response.headers["retry-after"]) {
                                        setTimeout(() => {
                                            callback();
                                            this.request(method, url, auth, body, file, route, true).then(resolve).catch(reject);
                                        }, +response.headers["retry-after"]);
                                        return;
                                    } else {
                                        callback();
                                        this.request(method, url, auth, body, file, route, true).then(resolve).catch(reject);
                                        return;
                                    }
                                } else if (response.statusCode === 502 && ++attempts < this.options.maximumAttempts - 1) {
                                    this.emit("debug", "A wild 502 appeared! Thanks CloudFlare!");
                                    setTimeout(() => {
                                        this.request(method, url, auth, body, file, route, true).then(resolve).catch(reject);
                                    }, this.options.retryTime);
                                    return callback();
                                }
                                callback();

                                if (response.length > 0) {
                                    if (response.headers["content-type"] === "application/json") {
                                        try {
                                            response = JSON.parse(response);
                                        } catch (err) {
                                            reject(err);
                                            return;
                                        }
                                    }
                                }

                                let stack = stackHolder.stack;
                                if (stack.startsWith("Error\n")) {
                                    stack = stack.substring(6);
                                }
                                let err;
                                if (response.code) {
                                    err = new DiscordRESTError(request, response, responseString, stack);
                                } else {
                                    err = new DiscordHTTPError(request, response, responseString, stack);
                                }
                                reject(err);
                                return;
                            }

                            if (response.length > 0) {
                                if (response.headers["content-type"] === "application/json") {
                                    try {
                                        response = JSON.parse(response);
                                    } catch (err) {
                                        callback();
                                        reject(err);
                                        return;
                                    }
                                }
                            }

                            callback();
                            resolve(response);
                        });
                });

                request.setTimeout(this.options.requestTimeout, () => {
                    requestError = new Error(`Request timed out (>${this.options.requestTimeout} on ${method} ${url}`);
                    request.abort();
                });
                if (Array.isArray(data)) {
                    for (const chunk of data) {
                        request.write(chunk);
                    }
                    request.end();
                } else {
                    request.end(data);
                }
            };

            if (this.blocked && auth) {
                this.queue.push(() => {
                    if (!this.buckets[route]) {
                        this.buckets[route] = new Bucket(this.options.initialThreshold, this.latencyReference.latency);
                    }
                    this.buckets[route].queue(actualCall, immediate);
                })
            } else {
                if (!this.buckets[route]) {
                    this.buckets[route] = new Bucket(this.options.initialThreshold, this.latencyReference.latency);
                }
                this.buckets[route].queue(actualCall, immediate);
            }
        })

    }

    private static getRoute(method: string, url: string): string {
        let route = url
            .replace(
                /\/([a-z-]+)\/(?:[0-9]{17,19})/g,
                (match, p) => ["channels", "guilds", "webhooks"].indexOf(p) >= 0 ? match : `/${p}/:id`
            )
            .replace(/\/reactions\/[^/]+/g, "/reactions/:id")
            .replace(/^\/webhooks\/(\d+)\/[A-Za-z0-9-_]{64,}/, "/webhooks/$1/:token");

        // Delete Message endpoint has its own ratelimit
        if (method === "DELETE" && route.endsWith("/messages/:id")) {
            route = method + route;
        }

        // PUT/DELETE one/all reactions is shared across the entire account
        if (~route.indexOf("/reactions/:id")) {
            route = "/channels/:id/messages/:id/reactions";
        }
        return route;
    }
}
