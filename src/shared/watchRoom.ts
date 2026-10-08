import { getStoredUserToken } from './authToken';
import { parseRoomSession } from './roomSession';
import type { PublicRoom, RoomVisibility, WatchRoomState, Profile } from './roomProtocol';
export type { RoomParticipant, RoomVisibility, RoomMedia, WatchRoomState, RoomCommandPayload } from './roomProtocol';
export { RoomClient } from './roomClient';
export type { RoomConnectionStatus } from './roomClient';
const BASE = (import.meta.env.VITE_ROOM_SERVER_URL || 'http://localhost:8787').replace(/\/$/, '');
let session: {token:string; session:string; expiresAt:number; profile:Profile} | null = null;
let sessionRequest: {token:string;promise:Promise<string>} | null = null;
const profileListeners = new Set<() => void>();
export function subscribeRoomProfile(listener: () => void) { profileListeners.add(listener); return () => { profileListeners.delete(listener); }; }
export function getAuthenticatedRoomProfile(): Profile | null { return session?.token === getStoredUserToken() ? session.profile : null; }
function notifyProfile() { for (const listener of profileListeners) listener(); }
export function getRoomServerUrl() { return BASE; }
async function responseJson<T>(response:Response):Promise<T> {
    let body: unknown;
    try { body = await response.json(); }
    catch {
        // Old Workers and upstream gateways may return HTML/text errors. Keep
        // their status so a permanent404 cannot become an endless reconnect.
        throw Object.assign(new Error(response.ok ? 'ROOM_INVALID_RESPONSE' : `HTTP ${response.status}`), { status: response.status });
    }
    if(!response.ok) {
        const error = body && typeof body === 'object' ? body as Record<string, unknown> : {};
        const message = [error.message, error.error, error.code].find(value => typeof value === 'string');
        throw Object.assign(new Error(typeof message === 'string' ? message : `HTTP ${response.status}`), { status: response.status });
    }
    return body as T;
}
async function authenticate():Promise<string> {
    const token=getStoredUserToken();
    if(!token) throw new Error('ROOM_SIGN_IN');
    if(session?.token===token && session.expiresAt>Date.now()+30000) return session.session;
    if(sessionRequest?.token===token) return sessionRequest.promise;
    const promise=(async()=> {
        const data=parseRoomSession(await responseJson<unknown>(await fetch(`${BASE}/api/v2/session`,{signal:AbortSignal.timeout(10000),method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})})));
        // A late response from a previous account must not replace current identity.
        if (getStoredUserToken() !== token) throw new Error('ROOM_ACCOUNT_CHANGED');
        session={...data,token};notifyProfile();return data.session;
    })();
    sessionRequest={token,promise};
    try{return await promise;} finally {if(sessionRequest?.promise===promise)sessionRequest=null;}
}
async function request<T>(path:string,body?:unknown):Promise<T> {
    const bearer=await authenticate();
    const response=await fetch(`${BASE}/api/v2${path}`,{signal:AbortSignal.timeout(10000),method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===401 && session?.session === bearer) { session=null; notifyProfile(); }
    return responseJson<T>(response);
}
export function createWatchRoom(input:{title:string;visibility:RoomVisibility}) {return request<{roomId:string;state:WatchRoomState}>('/rooms',input);}
export function getPublicWatchRooms(cursor?:string) {return fetch(`${BASE}/api/v2/rooms${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`, {signal:AbortSignal.timeout(10000)}).then(responseJson<{rooms:PublicRoom[];cursor:string|null}>);}
export function joinWatchRoom(roomId?:string,code?:string) {return request<{roomId:string;ticket:string}>('/rooms/join',{...(roomId?{roomId}:{}),...(code?{code}: {})});}
export function getRoomWebSocketUrl(roomId:string,ticket:string) {const url=new URL(`${BASE}/api/v2/rooms/${encodeURIComponent(roomId)}/ws`);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('ticket',ticket);return url.toString();}
