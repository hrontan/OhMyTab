import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {installSettingsBrowser,controlledEvent} from "../helpers/settings-browser.ts";
import type {BrowserTarget} from "../helpers/browser.ts";
import type {UndoEntry} from "../../src/operations/undo.ts";
const target=process.env.TEST_BROWSER as BrowserTarget;
type CreateProperties={url?:string;windowId?:number;index?:number;active?:boolean};
type Reply={ok:boolean;status?:string;entries?:UndoEntry[];restored?:number;failed?:number;unknown?:number;plan?:{token:string}};
let mock:ReturnType<typeof installSettingsBrowser>,tabs:chrome.tabs.Tab[],commanded:ReturnType<typeof controlledEvent<[string]>>,receiver:(request:unknown,sender:chrome.runtime.MessageSender,reply:(value:unknown)=>void)=>unknown;
let create:ReturnType<typeof vi.fn<(properties:CreateProperties)=>Promise<chrome.tabs.Tab>>>;
let messages:{addListener:ReturnType<typeof vi.fn>},nextId:number;
let baselineListeners: unknown[][];
const apiURL=(name:string)=>"chrome-extension://fixture/"+name;
const tab=(id:number,url="https://same.example/a",extra:Record<string,unknown>={})=>({id,url,title:"Tab"+id,index:id-1,windowId:1,active:id===1,pinned:false,incognito:false,status:"complete",groupId:-1,...(target==="firefox"?{cookieStoreId:"firefox-default"}:{}),...extra}) as chrome.tabs.Tab;
beforeEach(async()=>{
 vi.resetModules();mock=installSettingsBrowser(target);tabs=[tab(1),tab(2),tab(3,"https://other.example/")];nextId=100;
 Object.assign(mock.data,{preview_before:false,glue:false,depclean:true,sorttab:false,refresh:false,grouping:false,comclose:false,closelocal:false,rxclose:false,urlmatch:false});
 messages={addListener:vi.fn((fn:typeof receiver)=>{receiver=fn;})};Object.assign(mock.runtime,{id:"fixture",getURL:apiURL,onMessage:messages});
 commanded=controlledEvent<[string]>();Object.assign(mock.api,{commands:{onCommand:commanded}});
 mock.api.tabs.query.mockImplementation(async value=>{const q=value as chrome.tabs.QueryInfo;return tabs.filter(t=>(q.pinned==null||t.pinned===q.pinned)&&(!q.active||t.active)&&(!q.currentWindow||t.windowId===1)&&(q.windowId==null||t.windowId===q.windowId)).map(t=>({...t}));});
 mock.api.tabs.get.mockImplementation(async id=>{const found=tabs.find(t=>t.id===id);if(!found)throw Error("No tab");return {...found,id,status:found.status??"complete"};});
 mock.api.tabs.remove.mockImplementation(async ids=>{tabs=tabs.filter(t=>!ids.includes(t.id!));tabs.forEach((t,i)=>{t.index=i;});});
 const window={id:1,incognito:false,type:"normal" as const,focused:true,alwaysOnTop:false};mock.api.windows.getLastFocused.mockResolvedValue(window);mock.api.windows.getAll.mockResolvedValue([window as chrome.windows.Window]);
 create=vi.fn(async properties=>{const created=tab(nextId++,properties.url,{windowId:properties.windowId??1,index:properties.index??tabs.length,active:properties.active??true});for(const t of tabs)if(t.windowId===created.windowId&&t.index>=created.index)t.index++;tabs.push(created);return created;});Object.assign(mock.api.tabs,{create});
 await import("../../src/background/background.ts");
 baselineListeners=[...messages.addListener.mock.calls];
});
afterEach(()=>{vi.clearAllTimers();vi.unstubAllGlobals();});
async function close(){await commanded.emit("08_execute_option2");}
async function message(type:string,keys?:string[],senderPatch:Partial<chrome.runtime.MessageSender>={}):Promise<Reply>{
 const page=type.startsWith("preview:")?"preview.html":"undo.html";
 const previewURL=create.mock.calls.slice().reverse().find(call=>call[0].url?.includes("preview.html"))?.[0].url;
 const url=page==="preview.html"?previewURL!:apiURL(page);
 const token=page==="preview.html"?new URL(url).searchParams.get("token"):undefined;
 return await new Promise(resolve=>receiver({type,keys,token},{id:"fixture",url,tab:tab(999,url),...senderPatch},value=>resolve(value as Reply)));
}
test("default-off close records only successful supported IDs, restores original window/index with no store permission and consumes success",async()=>{
 await close();const reply=await message("undo:get");expect(reply.entries).toHaveLength(1);expect(reply.entries![0]).toMatchObject({url:"https://same.example/a",windowId:1,index:0,state:"ready"});
 const restored=await message("undo:restore",[reply.entries![0]!.key]);expect(restored).toMatchObject({ok:true,restored:1,failed:0,unknown:0,entries:[]});expect(create).toHaveBeenCalledExactlyOnceWith({windowId:1,url:"https://same.example/a",index:0,active:false});
 expect(tabs.find(t=>t.id===100)).toMatchObject({url:"https://same.example/a",windowId:1,index:0,incognito:false});expect(mock.api.storage.sync.set).not.toHaveBeenCalled();await message("undo:restore",[reply.entries![0]!.key]);expect(create).toHaveBeenCalledTimes(1);
});
test("T18A confirmed close records a restore item while cancelled preview records nothing",async()=>{
 mock.data.preview_before=true;await close();await message("preview:cancel");expect((await message("undo:get")).entries).toEqual([]);
 tabs=tabs.filter(t=>!t.url?.startsWith(apiURL("preview.html")));tabs[0]!.active=true;await close();await message("preview:confirm");
 expect((await message("undo:get")).entries).toHaveLength(1);expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
});
test("partial removal preserves only confirmed absent successes, not failed or newly pinned surviving IDs",async()=>{
 tabs[2]!.url="https://same.example/a";
 mock.api.tabs.remove.mockImplementationOnce(async()=>{tabs=tabs.filter(t=>t.id!==1);tabs.find(t=>t.id===2)!.pinned=true;throw Error("partial API failure");});
 await close();expect((await message("undo:get")).entries).toHaveLength(1);expect((await message("undo:get")).entries![0]?.index).toBe(0);
});
test("missing original window retains retryable entry and creates no fallback window",async()=>{
 await close();const key=(await message("undo:get")).entries![0]!.key;mock.api.windows.getAll.mockResolvedValue([]);
 expect(await message("undo:restore",[key])).toMatchObject({restored:0,failed:1});expect((await message("undo:get")).entries![0]?.state).toBe("ready");expect(create).not.toHaveBeenCalled();expect(mock.api.windows.create).not.toHaveBeenCalled();
});
test("post-create response loss stays unknown with no automatic or repeated create",async()=>{
 await close();const key=(await message("undo:get")).entries![0]!.key;create.mockImplementationOnce(async()=>{throw Error("response may have been lost");});
 expect(await message("undo:restore",[key])).toMatchObject({unknown:1});expect((await message("undo:get")).entries![0]?.state).toBe("unknown");await message("undo:restore",[key]);expect(create).toHaveBeenCalledTimes(1);
 await message("undo:delete",[key]);expect((await message("undo:get")).entries).toEqual([]);
});
test("forged/private/nondefault UI sender cannot read or restore normal records",async()=>{
 await close();expect(await message("undo:get",undefined,{id:"other"})).toMatchObject({ok:false});expect(await message("undo:get",undefined,{tab:tab(999,apiURL("undo.html"),{incognito:true})})).toMatchObject({ok:false});
 if(target==="firefox")expect(await message("undo:get",undefined,{tab:tab(999,apiURL("undo.html"),{cookieStoreId:"firefox-container-2"})})).toMatchObject({ok:false});expect(create).not.toHaveBeenCalled();
});
test.each(target==="firefox"?["private","container","unknown-store","internal"] as const:["private","internal"] as const)("%s closures are outside restoration scope",async kind=>{
 if(kind==="private"){tabs.forEach(t=>{t.incognito=true;});}
 if(kind==="container"&&target==="firefox")tabs.forEach(t=>Object.assign(t,{cookieStoreId:"firefox-container-1"}));
 if(kind==="unknown-store"&&target==="firefox")tabs.forEach(t=>{delete (t as chrome.tabs.Tab & {cookieStoreId?:string}).cookieStoreId;});
 if(kind==="internal")tabs[0]!.url=tabs[1]!.url="about:blank";
 await close();
 // Permanent workflow handlers remain; unsupported closures must not install a lazy undo handler.
 expect(messages.addListener.mock.calls).toEqual(baselineListeners);
 const respond=vi.fn();
 for(const [handler] of messages.addListener.mock.calls)handler({type:"undo:get"},{id:"fixture",url:apiURL("undo.html"),tab:tab(999,apiURL("undo.html"))},respond);
 expect(respond).not.toHaveBeenCalled();
});
test("double restore and delete while create pending cannot duplicate or erase the uncertain entry",async()=>{
 await close();const key=(await message("undo:get")).entries![0]!.key;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const native=create.getMockImplementation()!;
 create.mockImplementationOnce(async props=>{await gate;return native(props);});const first=message("undo:restore",[key]);await vi.waitFor(()=>expect(create).toHaveBeenCalledTimes(1));
 expect(await message("undo:restore",[key])).toMatchObject({ok:false,status:"busy"});expect(await message("undo:clear")).toMatchObject({ok:false,status:"busy"});release();expect(await first).toMatchObject({restored:1});expect(create).toHaveBeenCalledTimes(1);expect((await message("undo:get")).entries).toEqual([]);
});
