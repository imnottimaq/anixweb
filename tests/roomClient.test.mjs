import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomClient } from '../src/shared/roomClient.ts';
class Socket extends EventTarget {
    readyState=0; sent=[];
    open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
    message(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
    send(value){this.sent.push(JSON.parse(value));}
    close(){if(this.readyState===3)return;this.readyState=3;this.dispatchEvent(new Event('close'));}
}
const snapshot=(revision=1)=>({protocolVersion:2,revision,roomId:'room-one',joinCode:'AB12CD34',title:'Test',visibility:'public',hostId:1,media:null,mediaVersion:0,syncEpoch:0,playback:{position:0,paused:true,intent:'paused',rate:1,updatedAt:1000},barrier:null,participants:[],emptySince:null,closed:false});
function setup(){
    const sockets=[],states=[],statuses=[],errors=[],terminals=[];let mono=0;
    const client=new RoomClient({ticket:async()=>({roomId:'room-one',ticket:'one-use'}),url:()=> 'ws://local',socket:()=>{const s=new Socket();sockets.push(s);return s;},monotonic:()=>mono,random:()=>.5},{state:s=>states.push(s),status:s=>statuses.push(s),error:e=>errors.push(e)});
    client.setTerminalHandler(reason=>terminals.push(reason));
    return {client,sockets,states,statuses,errors,terminals,setMono(value){mono=value;}};
}
test('snapshot validation and revision ordering apply only fresh authoritative state',async()=> {
    const h=setup();await h.client.connect('room-one');const s=h.sockets[0];s.open();
    s.message({type:'room_state',state:snapshot(3),serverTime:1000});s.message({type:'room_state',state:snapshot(2),serverTime:1000});
    assert.deepEqual(h.states.map(s=>s.revision),[3]);assert.equal(h.statuses.at(-1),'connected');
    s.message({type:'room_state',state:{...snapshot(4),playback:null},serverTime:1000});assert.equal(h.states.length,1);assert.equal(h.errors.at(-1),'INVALID_SERVER_MESSAGE');h.client.disconnect();
});
test('commands use IDs/media version, await ack and reject server denial',async()=> {
    const h=setup();await h.client.connect('room-one');const s=h.sockets[0];s.open();
    await assert.rejects(h.client.send({type:'play',position:0}),/ROOM_NOT_CONNECTED/);
    s.message({type:'room_state',state:{...snapshot(),mediaVersion:4},serverTime:1000});
    const accepted=h.client.send({type:'pause',position:12});const cmd=s.sent.at(-1);assert.equal(cmd.mediaVersion,4);assert.equal(typeof cmd.commandId,'string');s.message({type:'ack',commandId:cmd.commandId,revision:2});await accepted;
    const denied=h.client.send({type:'play',position:12});const assertion=assert.rejects(denied,/Forbidden/);s.message({type:'error',commandId:s.sent.at(-1).commandId,code:'FORBIDDEN',message:'Forbidden'});await assertion;h.client.disconnect();
});
test('close rejects pending commands; reconnect gets ticket and never replays them',async()=> {
    const h=setup();await h.client.connect('room-one');let s=h.sockets[0];s.open();s.message({type:'room_state',state:snapshot(),serverTime:1000});
    const pending=h.client.send({type:'play',position:10});const rejected=assert.rejects(pending,/ROOM_DISCONNECTED/);s.close();await rejected;assert.equal(h.statuses.at(-1),'reconnecting');
    await new Promise(resolve=>setTimeout(resolve,550));assert.equal(h.sockets.length,2);s=h.sockets[1];s.open();assert.equal(s.sent.filter(v=>v.type==='play').length,0);
    await assert.rejects(h.client.send({type:'seek',position:10}),/ROOM_NOT_CONNECTED/);s.message({type:'room_state',state:snapshot(2),serverTime:1500});assert.equal(h.statuses.at(-1),'connected');h.client.disconnect();
});
test('session replacement stops reconnection until explicit connect',async()=> {
    const h=setup();await h.client.connect('room-one');const s=h.sockets[0];s.open();s.message({type:'session_replaced'});assert.equal(h.statuses.at(-1),'replaced');assert.deepEqual(h.terminals,['session_replaced']);
    await new Promise(resolve=>setTimeout(resolve,550));assert.equal(h.sockets.length,1);await h.client.connect('room-one');assert.equal(h.sockets.length,2);h.client.disconnect();
});

test('closing a room requires an ack or authoritative closure, not a dropped connection', async () => {
    const h = setup();
    try {
        await h.client.connect('room-one');
        const socket = h.sockets[0];
        socket.open();
        socket.message({ type: 'room_state', state: snapshot(), serverTime: 1000 });
        const pending = h.client.send({ type: 'close_room' });
        const rejected = assert.rejects(pending, /ROOM_DISCONNECTED/);
        socket.close();
        await rejected;
    } finally { h.client.disconnect(); }
});

test('an authoritative room_closed event completes a pending closure without an ack', async () => {
    const h = setup();
    try {
        await h.client.connect('room-one');
        const socket = h.sockets[0];
        socket.open();
        socket.message({ type: 'room_state', state: snapshot(), serverTime: 1000 });
        const pending = h.client.send({ type: 'close_room' });
        socket.message({ type: 'room_closed' });
        await pending;
        assert.deepEqual(h.terminals, ['room_closed']);
    } finally { h.client.disconnect(); }
});
test('clock estimates RTT and advances with monotonic time',async()=> {
    const h=setup();await h.client.connect('room-one');const s=h.sockets[0];s.open();const ping=s.sent[0];h.setMono(100);s.message({type:'pong',requestId:ping.requestId,serverTime:2000});assert.equal(h.client.serverNow(),2050);h.setMono(300);assert.equal(h.client.serverNow(),2250);h.client.disconnect();
});
test('late ticket result cannot open abandoned room',async()=> {
    let release;let sockets=0;const client=new RoomClient({ticket:()=>new Promise(resolve=>{release=resolve;}),url:()=>'',socket:()=>{sockets++;return new Socket();}},{state(){},status(){},error(){}});
    const connecting=client.connect('room-one');client.disconnect();release({roomId:'room-one',ticket:'unused'});await connecting;assert.equal(sockets,0);
});
test('private room rejection is terminal and does not retry tickets',async()=> {
    let attempts=0;const statuses=[];const client=new RoomClient({ticket:async()=>{attempts++;throw Object.assign(new Error('INVITE_REQUIRED'),{status:403});},url:()=>''},{state(){},status:s=>statuses.push(s),error(){}});
    await client.connect('room-one');assert.equal(statuses.at(-1),'error');await new Promise(resolve=>setTimeout(resolve,550));assert.equal(attempts,1);client.disconnect();
});
