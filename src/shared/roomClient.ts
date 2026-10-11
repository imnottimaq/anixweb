import { parseServerMessage, type RoomCommandPayload, type WatchRoomState, type RoomReaction } from './roomProtocol.ts';
export type RoomConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'replaced' | 'error';
export type RoomTerminalReason = 'kicked' | 'session_replaced' | 'room_closed' | 'unavailable';
type Callbacks = { state(state: WatchRoomState): void; status(status: RoomConnectionStatus): void; error(error: string | null): void; terminal?(reason: RoomTerminalReason): void; reaction?(reaction: RoomReaction): void };
type TransportOptions = { ticket(roomId: string, code?: string): Promise<{roomId:string; ticket:string}>; url(roomId:string,ticket:string):string; socket?(url:string):WebSocket; monotonic?():number; wall?():number; random?():number };

// One instance belongs to RoomProvider; navigation never owns this connection.
export class RoomClient {
    private socket: WebSocket | null = null;
    private generation = 0;
    private attempts = 0;
    private retry: ReturnType<typeof setTimeout> | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private handshake: ReturnType<typeof setTimeout> | null = null;
    private roomId: string | null = null;
    private code?: string;
    private revision = -1;
    private mediaVersion = 0;
    private connected = false;
    private pending = new Map<string, {resolve():void; reject(error:Error):void; timer:ReturnType<typeof setTimeout>; type?: string}>();
    private pings = new Map<string, number>();
    private serverAnchor: {server:number; monotonic:number} | null = null;
    private bestRtt = Infinity;
    private callbacks: Callbacks;
    private options: TransportOptions;
    constructor(options:TransportOptions, callbacks:Callbacks) { this.options=options; this.callbacks=callbacks; }
    setTerminalHandler(callback: (reason: RoomTerminalReason) => void) { this.callbacks.terminal = callback; }
    setStatusHandler(callback: (status: RoomConnectionStatus) => void) { this.callbacks.status = callback; }
    setReactionHandler(callback: (reaction: RoomReaction) => void) { this.callbacks.reaction = callback; }
    private now() { return this.options.monotonic?.() ?? performance.now(); }
    serverNow() { return this.serverAnchor ? this.serverAnchor.server + this.now()-this.serverAnchor.monotonic : (this.options.wall?.() ?? Date.now()); }
    async connect(roomId:string,code?:string) {
        this.disconnect(); this.roomId=roomId; this.code=code; this.revision=-1; this.attempts=0; this.bestRtt=Infinity;
        this.callbacks.error(null); this.callbacks.status('connecting');
        await this.open(this.generation);
    }
    private async open(generation:number) {
        try {
            const ticket=await this.options.ticket(this.roomId!,this.code);
            if (generation!==this.generation) return;
            this.roomId=ticket.roomId;
            const socket=(this.options.socket ?? (url=>new WebSocket(url)))(this.options.url(ticket.roomId,ticket.ticket));
            this.socket=socket;
            this.handshake=setTimeout(()=>socket.close(4000,'Handshake timeout'),10000);
            socket.addEventListener('open',()=> { if(this.socket===socket) this.ping(); });
            socket.addEventListener('message',event=> {
                if (this.socket!==socket) return;
                try {
                    const message=parseServerMessage(JSON.parse(String(event.data)));
                    if(message.type==='room_state') {
                        if(message.state.roomId!==this.roomId) throw new Error('Room identity mismatch');
                        if(this.handshake) clearTimeout(this.handshake); this.handshake=null;
                        const isFirstSnapshot = !this.connected;
                        this.attempts=0; this.connected=true; this.callbacks.status('connected'); this.callbacks.error(null);
                        if(!this.serverAnchor) this.serverAnchor={server:message.serverTime,monotonic:this.now()};
                        if (isFirstSnapshot || message.state.revision > this.revision) {
                            this.revision = message.state.revision;
                            this.mediaVersion = message.state.mediaVersion;
                            this.callbacks.state(message.state);
                        }
                        if(!this.heartbeat) this.heartbeat=setInterval(()=>this.ping(),5000);
                    } else if(message.type==='ack' || message.type==='error') {
                        const commandId=message.commandId;
                        const pending=commandId && this.pending.get(commandId);
                        if(pending) { clearTimeout(pending.timer); this.pending.delete(commandId!); if(message.type==='ack') pending.resolve(); else pending.reject(new Error(message.message)); }
                        if(message.type==='error') this.callbacks.error(message.message);
                    } else if(message.type==='pong') {
                        const start=this.pings.get(message.requestId); this.pings.delete(message.requestId);
                        if(start!==undefined) { const rtt=this.now()-start; if(rtt<=this.bestRtt) { this.bestRtt=rtt; this.serverAnchor={server:message.serverTime+rtt/2,monotonic:this.now()}; } }
                    } else if(message.type==='reaction') {
                        this.callbacks.reaction?.(message.reaction);
                    } else {
                        if (message.type === 'room_closed') {
                            for (const [cmdId, p] of this.pending) {
                                if (p.type === 'close_room') {
                                    clearTimeout(p.timer);
                                    p.resolve();
                                    this.pending.delete(cmdId);
                                }
                            }
                        }
                        this.disconnect(); this.callbacks.status(message.type==='session_replaced'?'replaced':'error');
                        this.callbacks.error(message.type==='session_replaced'?'ROOM_REPLACED':message.type==='kicked'?'ROOM_KICKED':'ROOM_CLOSED'); this.callbacks.terminal?.(message.type);
                    }
                } catch(error) { this.callbacks.error(error instanceof Error?error.message:'Invalid server message'); }
            });
            socket.addEventListener('close',()=> { if(this.socket!==socket) return; this.socket=null; this.connected=false; this.clearTimers(); this.rejectPending(); this.scheduleRetry(generation); });
            socket.addEventListener('error',()=> { if(this.socket===socket) socket.close(); });
        } catch(error) {
            if(generation!==this.generation) return;
            this.callbacks.error(error instanceof Error?error.message:'Connection failed');
            if(error && typeof error==='object' && 'status' in error && [400,403,404,410].includes(Number(error.status))) {this.disconnect();this.callbacks.status('error');this.callbacks.error(error instanceof Error?error.message:'Room unavailable');this.callbacks.terminal?.('unavailable');return;}
            this.scheduleRetry(generation);
        }
    }
    private scheduleRetry(generation:number) {
        if(generation!==this.generation || !this.roomId) return;
        this.callbacks.status('reconnecting');
        const delay=Math.min(4000,500*2**this.attempts++)*(.8+(this.options.random?.()??Math.random())*.4);
        this.retry=setTimeout(()=> { this.retry=null; void this.open(generation); },delay);
    }
    private ping() {
        if(this.socket?.readyState!==1) return;
        const requestId=crypto.randomUUID(); this.pings.set(requestId,this.now());
        for(const [id,start] of this.pings) if(this.now()-start>15000) { this.pings.delete(id); this.socket.close(4000,'Heartbeat timeout'); return; }
        this.socket.send(JSON.stringify({type:'ping',requestId}));
    }
    send(payload:RoomCommandPayload):Promise<void> {
        if(this.socket?.readyState!==1 || !this.connected) return Promise.reject(new Error('ROOM_NOT_CONNECTED'));
        const commandId=crypto.randomUUID();
        return new Promise((resolve,reject)=> {
            const timer=setTimeout(()=> { this.pending.delete(commandId); reject(new Error('COMMAND_TIMEOUT')); },10000);
            this.pending.set(commandId,{resolve,reject,timer,type:payload.type});
            this.socket!.send(JSON.stringify({...payload,commandId,mediaVersion:this.mediaVersion}));
        });
    }
    private rejectPending() {
        for(const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            if (pending.type === 'close_room') {
                pending.resolve();
            } else {
                pending.reject(new Error('ROOM_DISCONNECTED'));
            }
        }
        this.pending.clear();
    }
    private clearTimers() { if(this.heartbeat) clearInterval(this.heartbeat);if(this.handshake) clearTimeout(this.handshake);this.heartbeat=null;this.handshake=null;this.pings.clear(); }
    disconnect() {
        this.generation++; this.connected=false; if(this.retry) clearTimeout(this.retry); this.retry=null;this.clearTimers();this.rejectPending();
        const socket=this.socket;this.socket=null;socket?.close(1000,'Closed by client');this.roomId=null;this.serverAnchor=null; this.callbacks.status('idle');
    }
}
