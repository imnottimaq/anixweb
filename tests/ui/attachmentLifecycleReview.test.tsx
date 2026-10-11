import { act, cleanup, render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VoiceRecorder from '../../src/components/VoiceRecorder';
import { useAttachmentBlob, clearAllAttachmentBlobs } from '../../src/shared/hooks/useAttachmentBlob';

const state = vi.hoisted(() => ({token:'account-a', get:vi.fn()}));
vi.mock('../../src/shared/contexts/userContext',()=>({useUser:()=>({userToken:state.token})}));
vi.mock('../../src/shared/watchRoom',()=>({getRoomAttachment:state.get}));
let created:string[], revoked:string[];
beforeEach(()=>{
    state.token='account-a';state.get.mockReset();created=[];revoked=[];
    vi.stubGlobal('URL',class extends URL {static createObjectURL(){const url=`blob:review-${created.length}`;created.push(url);return url;}static revokeObjectURL(url:string){revoked.push(url);}});
});
afterEach(()=>{cleanup();clearAllAttachmentBlobs();vi.unstubAllGlobals();});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
it('parallel attachment views revoke every allocated URL on unmount',async()=>{
    const first=deferred<Blob>(),second=deferred<Blob>();state.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a=renderHook(()=>useAttachmentBlob('room','image'));
    const b=renderHook(()=>useAttachmentBlob('room','image'));
    await act(async()=>{first.resolve(new Blob(['one']));second.resolve(new Blob(['two']));});
    await waitFor(()=>{expect(a.result.current.url).toBeTruthy();expect(b.result.current.url).toBeTruthy();});
    a.unmount();b.unmount();
    expect(new Set(revoked)).toEqual(new Set(created));
});
it('retry does not retain an extra reference to the same image URL',async()=>{
    state.get.mockResolvedValue(new Blob(['image']));
    const view=renderHook(()=>useAttachmentBlob('room','retry'));
    await waitFor(()=>expect(view.result.current.url).toBeTruthy());
    await act(async()=>{await view.result.current.retry();});view.unmount();
    expect(new Set(revoked)).toEqual(new Set(created));
});
it('account change aborts an old fetch and does not publish its late bytes',async()=>{
    const old=deferred<Blob>();let oldSignal:AbortSignal|undefined;
    state.get.mockImplementationOnce((_room:string,_id:string,signal:AbortSignal)=>{oldSignal=signal;return old.promise;}).mockResolvedValue(new Blob(['new account']));
    const view=renderHook(()=>useAttachmentBlob('room','account-sensitive'));
    await waitFor(()=>expect(state.get).toHaveBeenCalledTimes(1));
    state.token='account-b';view.rerender();
    await waitFor(()=>expect(oldSignal?.aborted).toBe(true));
    await act(async()=>{old.resolve(new Blob(['old account']));});
    expect(state.get).toHaveBeenCalledTimes(2);
    view.unmount();expect(new Set(revoked)).toEqual(new Set(created));
});
it('account change revokes a displayed image even when room and file IDs stay the same',async()=>{
    state.get.mockResolvedValue(new Blob(['image']));
    const view=renderHook(()=>useAttachmentBlob('room','same-file'));
    await waitFor(()=>expect(view.result.current.url).toBeTruthy());const old=view.result.current.url!;
    state.token='account-b';view.rerender();
    await waitFor(()=>expect(revoked).toContain(old));
    await waitFor(()=>expect(view.result.current.url).not.toBe(old));
    view.unmount();expect(new Set(revoked)).toEqual(new Set(created));
});

vi.mock('../../src/shared/useTranslation',()=>({useTranslation:()=>({language:'english',t:(key:string)=>({
    'roomSocial.recordVoice':'Voice message', 'roomSocial.stopRecording':'Stop recording','roomSocial.cancelRecording':'Cancel recording', 'roomSocial.sendVoice':'Send voice message',
}[key]??key)})}));
function microphone() {
    const stop=vi.fn();return {stream:{getTracks:()=>[{stop}]} as unknown as MediaStream,stop};
}
class Recorder {
    static all:Recorder[]=[];
    static isTypeSupported(){return true;}
    state='inactive';mimeType='audio/webm';
    onstop:(()=>void)|null=null;
    ondataavailable:((event:{data:Blob})=>void)|null=null;
    onerror:(()=>void)|null=null;
    constructor(){Recorder.all.push(this);}
    start(){this.state='recording';}
    stop(){this.state='inactive';}
}
function recorderEnvironment(getUserMedia:ReturnType<typeof vi.fn>) {
    Recorder.all=[];vi.stubGlobal('MediaRecorder',Recorder);
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
    return render(<VoiceRecorder onSend={vi.fn().mockResolvedValue(undefined)}/>);
}
it('cancel then restart does not adopt the previous late microphone permission result',async()=>{
    const pending=deferred<MediaStream>(),oldMic=microphone(),newMic=microphone();
    recorderEnvironment(vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(newMic.stream));
    fireEvent.click(screen.getByRole('button',{name:'Voice message'}));
    fireEvent.click(screen.getByRole('button',{name:'Cancel recording'}));
    fireEvent.click(screen.getByRole('button',{name:'Voice message'}));
    await waitFor(()=>expect(Recorder.all).toHaveLength(1));
    await act(async()=>{pending.resolve(oldMic.stream);});
    expect(oldMic.stop).toHaveBeenCalled();expect(Recorder.all).toHaveLength(1);
    expect(newMic.stop).not.toHaveBeenCalled();
});
it('stopping while permission is pending releases a late stream without starting a recorder',async()=>{
    const pending=deferred<MediaStream>(),mic=microphone();
    recorderEnvironment(vi.fn().mockReturnValueOnce(pending.promise));
    fireEvent.click(screen.getByRole('button',{name:'Voice message'}));
    fireEvent.click(screen.getByRole('button',{name:'Stop recording'}));
    await act(async()=>{pending.resolve(mic.stream);});
    expect(mic.stop).toHaveBeenCalled();expect(Recorder.all).toHaveLength(0);
});
it('a cancelled recorder late stop event cannot stop or replace the next recording',async()=>{
    const firstMic=microphone(),secondMic=microphone();
    recorderEnvironment(vi.fn().mockResolvedValueOnce(firstMic.stream).mockResolvedValueOnce(secondMic.stream));
    fireEvent.click(screen.getByRole('button',{name:'Voice message'}));
    await waitFor(()=>expect(Recorder.all).toHaveLength(1));const oldStop=Recorder.all[0].onstop;
    fireEvent.click(screen.getByRole('button',{name:'Cancel recording'}));
    fireEvent.click(screen.getByRole('button',{name:'Voice message'}));
    await waitFor(()=>expect(Recorder.all).toHaveLength(2));
    await act(async()=>{oldStop?.();});
    expect(secondMic.stop).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Stop recording'})).toBeInTheDocument();
});

it('unmounting one attachment leaves another rendered attachment URL alive',async()=>{
    state.get.mockResolvedValue(new Blob(['image']));
    const first=renderHook(()=>useAttachmentBlob('room','first'));
    const second=renderHook(()=>useAttachmentBlob('room','second'));
    await waitFor(()=>{expect(first.result.current.url).toBeTruthy();expect(second.result.current.url).toBeTruthy();});
    const survivor=second.result.current.url!;first.unmount();
    expect(revoked).not.toContain(survivor);
    second.unmount();expect(revoked).toContain(survivor);
});
it('losing the connection stops the microphone and preserves a voice draft for later retry',async()=>{
    const mic=microphone();const onSend=vi.fn();
    const view=recorderEnvironment(vi.fn().mockResolvedValue(mic.stream));
    fireEvent.click(screen.getByRole('button',{name:'Voice message'}));
    await waitFor(()=>expect(Recorder.all).toHaveLength(1));
    const recorder=Recorder.all[0];
    view.rerender(<VoiceRecorder disabled onSend={onSend}/>);
    await waitFor(()=>expect(mic.stop).toHaveBeenCalled());
    await act(async()=>{recorder.ondataavailable?.({data:new Blob(['voice'])});recorder.onstop?.();});
    const send=screen.getByRole('button',{name:'Send voice message'});expect(send).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
    view.rerender(<VoiceRecorder onSend={onSend}/>);
    expect(screen.getByRole('button',{name:'Send voice message'})).toBeEnabled();
});
