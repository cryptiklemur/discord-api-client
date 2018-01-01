export default class MultipartData {
    private boundary: string = "----------------DiscordApiClient";
    private buffers: Buffer[] = [];

    public attach(fieldName: string, data: any, filename: string) {
        if (data === undefined) {
            return;
        }

        let str = "\r\n--" + this.boundary + "\r\nContent-Disposition: form-data; name=\"" + fieldName + "\"";
        if (filename) {
            str += "; filename=\"" + filename + "\"";
        }

        if (data instanceof Buffer) {
            str += "\r\nContent-Type: application/octet-stream";
        } else if (typeof data === "object") {
            str += "\r\nContent-Type: application/json";
            data = new Buffer(JSON.stringify(data));
        } else {
            data = new Buffer("" + data);
        }

        this.buffers.push(new Buffer(str + "\r\n\r\n"));
        this.buffers.push(data);
    }

    public finish() {
        this.buffers.push(new Buffer("\r\n--" + this.boundary + "--"));

        return this.buffers;
    }
}
