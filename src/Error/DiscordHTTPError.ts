export default class DiscordHTTPError extends Error {
    public readonly code: number;
    public readonly message: string;

    constructor(public readonly req, public readonly res, public readonly response, public readonly stack) {
        super();

        this.code = res.statusCode;
        let message = `${this.name}: ${res.statusCode} ${res.statusMessage} on ${req.method} ${req.path}`;
        const errors = this.flattenErrors(response);
        if (errors.length > 0) {
            message += "\n  " + errors.join("\n  ");
        }
        this.message = message;

        if (stack) {
            this.stack = this.message += "\n" + stack;
        } else {
            Error.captureStackTrace(this, DiscordHTTPError);
        }
    }

    get name() {
        return this.constructor.name;
    }

    private flattenErrors(errors: any[], keyPrefix?: string) {
        keyPrefix = keyPrefix || "";

        let messages = [];
        for (const fieldName in errors) {
            if (fieldName === "message" || fieldName === "code") {
                continue;
            }
            if (Array.isArray(errors[fieldName])) {
                messages = messages.concat(errors[fieldName].map((str) => `${keyPrefix + fieldName}: ${str}`));
            }
        }
        return messages;
    }
}
