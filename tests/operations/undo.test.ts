import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {UndoBuffer,UNDO_LIMIT,UNDO_TTL_MS,normalDefaultSession,type UndoEntry} from "../../src/operations/undo.ts";
import type {TabType} from "../../src/browser/browser-api.ts";
const tab=(id:number,extra:Record<string,unknown>={})=>({id,url:"https://example.org/"+id,windowId:1,index:id,incognito:false,cookieStoreId:"firefox-default",...extra}) as TabType;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-21T00:00:00Z"));});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
test("one latest supported batch, 50 entries and real timer expiry bound URL memory",()=>{
 const buffer=new UndoBuffer();buffer.record(Array.from({length:60},(_,i)=>tab(i)),true);expect(buffer.read().entries).toHaveLength(UNDO_LIMIT);
 vi.advanceTimersByTime(UNDO_TTL_MS-1);expect(buffer.read().entries).toHaveLength(50);vi.advanceTimersByTime(1);expect(buffer.read().entries).toEqual([]);
 buffer.record([tab(9)],true);expect(buffer.read().entries[0]?.url).toBe("https://example.org/9");
 const replacement=buffer.read().expiresAt;vi.advanceTimersByTime(1);buffer.record([tab(10)],true);expect(buffer.read().entries).toHaveLength(1);expect(buffer.read().expiresAt).toBe(replacement!+1);
});
test.each([
 {incognito:true},{incognito:undefined},{cookieStoreId:"firefox-container-1"},{cookieStoreId:undefined},
 {url:"file:///C:/private.txt"},{url:"about:blank"},{url:"data:text/html,secret"},{url:"https://user:secret@example.org/"},{url:"https://example.org/"+ "a".repeat(4096)},{windowId:undefined},{index:-1},
])("unsupported/private/unknown metadata is not retained: %j",extra=>{
 const buffer=new UndoBuffer();expect(buffer.record([tab(1,extra)],true)).toBe(false);expect(buffer.read().entries).toEqual([]);
});
test("Chrome requires normal privacy but no cookie store field; Firefox requires confirmed default",()=>{
 expect(normalDefaultSession(tab(1,{cookieStoreId:undefined}),false)).toBe(true);expect(normalDefaultSession(tab(1,{cookieStoreId:undefined}),true)).toBe(false);
});
test("partial restore consumes only success, keeps failures and disables uncertain retries",async()=>{
 const buffer=new UndoBuffer();buffer.record([tab(1),tab(2),tab(3)],true);const entries=buffer.read().entries;
 const create=vi.fn(async(entry:UndoEntry)=>entry.index===1?"restored" as const:entry.index===2?"failed" as const:"unknown" as const);
 expect(await buffer.restore(entries.map(e=>e.key),create)).toMatchObject({restored:1,failed:1,unknown:1});
 expect(buffer.read().entries.map(e=>e.state)).toEqual(["ready","unknown"]);
 await buffer.restore(entries.map(e=>e.key),create);expect(create).toHaveBeenCalledTimes(4);
 buffer.remove([entries[2]!.key]);expect(buffer.read().entries).toHaveLength(1);buffer.remove();expect(buffer.read().entries).toEqual([]);
});
test("restore/create uncertainty survives and cannot cause duplicate creation",async()=>{
 const buffer=new UndoBuffer();buffer.record([tab(1)],true);const key=buffer.read().entries[0]!.key;
 const create=vi.fn(async()=>{throw Error("response lost after creating");});
 expect(await buffer.restore([key],create)).toMatchObject({unknown:1});await buffer.restore([key],create);expect(create).toHaveBeenCalledTimes(1);expect(buffer.read().entries[0]?.state).toBe("unknown");
});
test("concurrent restore and deletion are refused while one create is pending",async()=>{
 const buffer=new UndoBuffer();buffer.record([tab(1)],true);const key=buffer.read().entries[0]!.key;let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const first=buffer.restore([key],async()=>{await gate;return "restored";});
 expect(await buffer.restore([key],async()=>"restored")).toMatchObject({status:"busy"});expect(buffer.remove()).toBe(false);expect(buffer.record([tab(2)],true)).toBe(false);
 release();await first;expect(buffer.read().entries).toEqual([]);
});
test("expiry during restore stops later entries, and new worker memory has no history",async()=>{
 const buffer=new UndoBuffer();buffer.record([tab(1),tab(2)],true);const create=vi.fn(async()=>{vi.setSystemTime(Date.now()+UNDO_TTL_MS);return "restored" as const;});
 await buffer.restore(buffer.read().entries.map(e=>e.key),create);expect(create).toHaveBeenCalledTimes(1);expect(buffer.read().entries).toEqual([]);expect(new UndoBuffer().read().entries).toEqual([]);
});
