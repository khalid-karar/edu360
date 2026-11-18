import { connect } from "node:net";

export type ScanResult = { clean: true } | { clean: false; signature: string };

/** Looks at a file's bytes before it is stored. Throws when it cannot give an answer. */
export interface Scanner {
  scan(data: Buffer): Promise<ScanResult>;
}

const CHUNK = 64 * 1024;

/**
 * ClamAV's clamd over TCP, using the INSTREAM command: the file goes in length-prefixed chunks and clamd answers
 * "stream: OK" or "stream: <signature> FOUND". Anything else (an error line, a timeout, a dropped connection) throws.
 */
export class ClamdScanner implements Scanner {
  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs = 30_000) {}

  scan(data: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const sock = connect({ host: this.host, port: this.port });
      let reply = "";
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sock.destroy();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("clamd timed out"))), this.timeoutMs);
      sock.on("error", (e) => finish(() => reject(e)));
      sock.on("data", (d) => { reply += d.toString("utf8"); });
      sock.on("end", () => finish(() => {
        const line = reply.replace(/\0/g, "").trim();
        if (/^stream: OK$/.test(line)) return resolve({ clean: true });
        const m = /^stream: (.+) FOUND$/.exec(line);
        if (m) return resolve({ clean: false, signature: m[1]! });
        reject(new Error(`clamd said: ${line.slice(0, 120) || "nothing"}`));
      }));
      sock.on("connect", () => {
        sock.write("zINSTREAM\0");
        for (let i = 0; i < data.length; i += CHUNK) {
          const part = data.subarray(i, i + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          sock.write(len);
          sock.write(part);
        }
        sock.write(Buffer.alloc(4)); // a zero-length chunk ends the stream
      });
    });
  }
}
