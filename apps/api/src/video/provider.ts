import { createHmac } from "node:crypto";

export interface RoomTicket {
  /** WebSocket URL of the media server. */
  url: string;
  token: string;
}

export interface TicketRequest {
  room: string;
  identity: string;
  name: string;
  /** Seconds the ticket stays valid. */
  ttlSec: number;
  now: Date;
}

/** Issues short-lived tickets to a video room. The media server itself (LiveKit) carries the video, audio and whiteboard data. */
export interface VideoProvider {
  ticket(r: TicketRequest): Promise<RoomTicket>;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/**
 * LiveKit access token: a JWT signed HS256 with the API secret. Written with node:crypto so there is no SDK to trust.
 * The grant lets the holder join one room, publish audio, video and data (whiteboard), and nothing else:
 * no room admin, no recording control, no joining other rooms.
 */
export class LiveKitVideo implements VideoProvider {
  constructor(private readonly url: string, private readonly apiKey: string, private readonly apiSecret: string) {}

  async ticket(r: TicketRequest): Promise<RoomTicket> {
    const nbf = Math.floor(r.now.getTime() / 1000) - 5;
    const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = b64u(
      JSON.stringify({
        iss: this.apiKey,
        sub: r.identity,
        name: r.name,
        nbf,
        exp: nbf + 5 + r.ttlSec,
        video: { room: r.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
      }),
    );
    const sig = createHmac("sha256", this.apiSecret).update(`${head}.${body}`).digest("base64url");
    return { url: this.url, token: `${head}.${body}.${sig}` };
  }
}

/** Tests and the local sandbox: no media server, the ticket just names the room. */
export class MockVideo implements VideoProvider {
  readonly issued: TicketRequest[] = [];
  async ticket(r: TicketRequest): Promise<RoomTicket> {
    this.issued.push(r);
    return { url: "mock://video", token: `mock.${r.room}.${r.identity}` };
  }
}
