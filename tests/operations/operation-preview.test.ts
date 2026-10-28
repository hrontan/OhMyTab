import {afterEach,beforeEach,expect,test,vi} from "vitest";
import type {Mock} from "vitest";
import {installSettingsBrowser} from "../helpers/settings-browser.ts";
import type {BrowserTarget} from "../helpers/browser.ts";
import type {PreviewPlan} from "../../src/operations/operation-plan.ts";
type PreviewReply={ok:boolean;status?:string;plan?:PreviewPlan};
type PreviewTabs=ReturnType<typeof installSettingsBrowser>["api"]["tabs"] & {
 create:Mock<(details:{url:string;windowId:number})=>Promise<chrome.tabs.Tab>>;
 group:Mock<()=>Promise<number>>;
 ungroup:Mock<()=>Promise<void>>;
};
type PreviewApi=ReturnType<typeof installSettingsBrowser>["api"] & {
 commands:{onCommand:{emit:(name:string)=>Promise<void>}};
 tabGroups:{query:Mock<()=>Promise<{id:number;title:string}[]>>;update:Mock<()=>Promise<void>>;move:Mock<()=>Promise<void>>};
};
const target=process.env.TEST_BROWSER as BrowserTarget;
let mock:ReturnType<typeof installSettingsBrowser>;
let tabs:chrome.tabs.Tab[];
let receiver:(message:unknown,sender:chrome.runtime.MessageSender,reply:(value:PreviewReply)=>void)=>unknown;
const tab=(id:number,url="https://same.example/a",extra:Partial<chrome.tabs.Tab>={})=>({id,url,title:"Tab "+id,index:id-1,windowId:1,active:id===1,pinned:false,incognito:false,groupId:-1,discarded:false,...(target==="firefox"?{cookieStoreId:"firefox-default"}:{}),...extra}) as chrome.tabs.Tab;
const apiURL=(name:string)=>"chrome-extension://fixture/"+name;
async function setup(){
 vi.resetModules();mock=installSettingsBrowser(target);tabs=[tab(1),tab(2),tab(3,"https://protected.example/")];
 Object.assign(mock.data,{preview_before:true,glue:false,depclean:true,sorttab:false,refresh:false,grouping:false,comclose:false,closelocal:false,rxclose:false,urlmatch:false,protect_domains:"protected.example"});
 Object.assign(mock.runtime,{id:"fixture",getURL:apiURL,onMessage:{addListener:vi.fn((fn: typeof receiver)=>{receiver=fn;})}});
 mock.api.tabs.query.mockImplementation(async value=>{const q=value as chrome.tabs.QueryInfo;return tabs.filter(t=>(q.pinned==null||t.pinned===q.pinned)&&(!q.active||t.active)&&(!q.currentWindow||t.windowId===1)&&(q.windowId==null||t.windowId===q.windowId)&&(q.groupId==null||t.groupId===q.groupId)).map(t=>({...t}));});
 mock.api.tabs.get.mockImplementation(async id=>{const t=tabs.find(t=>t.id===id);if(!t)throw Error("Missing tab");return {...t,id,status:t.status??"complete"};});
 mock.api.tabs.remove.mockImplementation(async ids=>{tabs=tabs.filter(t=>!ids.includes(t.id!));});
 const originWindow={id:1,incognito:false,type:"normal" as const,focused:true,alwaysOnTop:false};mock.api.windows.getLastFocused.mockResolvedValue(originWindow);
 mock.api.windows.getAll.mockResolvedValue([{id:1,incognito:false,type:"normal"},{id:2,incognito:false,type:"normal"}] as chrome.windows.Window[]);
 Object.assign(mock.api.tabs,{create:vi.fn(async (details: {url: string;windowId: number})=>{tabs.forEach(t=>{t.active=false;});const item=tab(90,details.url,{active:true,windowId:details.windowId});tabs.push(item);return item;}),group:vi.fn(async()=>1),ungroup:vi.fn(async()=>{})});
 Object.assign(mock.api,{tabGroups:{query:vi.fn(async()=>[]),update:vi.fn(async()=>{}),move:vi.fn(async()=>{})}});
 await import("../../src/background/background.ts");
}
beforeEach(setup);
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
async function command(name="08_execute_option2") {await (mock.api as PreviewApi).commands.onCommand.emit(name);}
async function message(type:string,token?:string,senderPatch:Partial<chrome.runtime.MessageSender>={}) {
 const url=((mock.api.tabs as PreviewTabs).create.mock.calls.at(-1)?.[0].url) as string;
 const selected=token??new URL(url).searchParams.get("token");
 return await new Promise<PreviewReply>(resolve=>receiver({type,token:selected},{id:"fixture",url,tab:tab(90,url,{active:true}),...senderPatch},resolve));
}
async function plan(){return (await message("preview:get")).plan as PreviewPlan;}
function noMutation(){expect(mock.api.tabs.remove).not.toHaveBeenCalled();expect(mock.api.tabs.move).not.toHaveBeenCalled();expect(mock.api.tabs.reload).not.toHaveBeenCalled();expect(mock.api.windows.create).not.toHaveBeenCalled();expect((mock.api.tabs as PreviewTabs).group).not.toHaveBeenCalled();expect((mock.api.tabs as PreviewTabs).ungroup).not.toHaveBeenCalled();expect((mock.api as PreviewApi).tabGroups.move).not.toHaveBeenCalled();expect((mock.api as PreviewApi).tabGroups.update).not.toHaveBeenCalled();}
test("dry-run exposes original IDs/reasons/window scope and protection reasons; cancel has zero mutations",async()=>{
 await command();const p=await plan();expect(p.targets.map(t=>t.id)).toEqual([1]);expect(p.targets[0]?.reasons).toEqual(["duplicate"]);expect(p.windowIds).toEqual([1]);expect(p.originId).toBe(1);expect(p.excluded).toMatchObject([{id:3,reasons:["protected-domain"]}]);noMutation();
 expect(await message("preview:cancel")).toMatchObject({ok:true,status:"cancelled"});noMutation();expect(await message("preview:confirm",p.token)).toMatchObject({ok:false,status:"expired"});
});
test("confirmation uses only original planned IDs even when preview activation changes active tab",async()=>{
 await command();const p=await plan();expect(await message("preview:confirm")).toMatchObject({ok:true,status:"complete"});expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);expect(tabs.map(t=>t.id)).toEqual([2,3,90]);expect(await message("preview:confirm",p.token)).toMatchObject({ok:false,status:"expired"});
});
test.each(["added","removed","url","window","pinned","audio","group","settings","origin","session"])("%s change rejects the entire plan before mutations",async change=>{
 await command();const p=await plan();
 if(change==="added")tabs.push(tab(4));if(change==="removed")tabs=tabs.filter(t=>t.id!==2);if(change==="url")tabs[0]!.url="https://new.example/";if(change==="window")tabs[0]!.windowId=2;if(change==="pinned")tabs[0]!.pinned=true;if(change==="audio")tabs[0]!.audible=true;if(change==="group")tabs[0]!.groupId=2;if(change==="settings")mock.data.protect_audible=true;if(change==="origin")tabs=tabs.filter(t=>t.id!==1);if(change==="session")tabs[0]!.incognito=true;
 const reply=await message("preview:confirm",p.token);expect(reply.ok).toBe(false);expect(["stale","failed"]).toContain(reply.status);noMutation();
});
test("two simultaneous confirmations consume the plan once",async()=>{
 await command();const p=await plan();const replies=await Promise.all([message("preview:confirm",p.token),message("preview:confirm",p.token)]);expect(replies.map(x=>x.ok).sort()).toEqual([false,true]);expect(mock.api.tabs.remove).toHaveBeenCalledTimes(1);
});
test("expiry and forged sender never expose or execute the plan",async()=>{
 await command();const p=await plan();expect(await message("preview:get",p.token,{id:"other"})).toMatchObject({ok:false});expect(await message("preview:get",p.token,{tab:tab(90,apiURL("preview.html"),{windowId:2})})).toMatchObject({ok:false});vi.spyOn(Date,"now").mockReturnValue(p.expiresAt);expect(await message("preview:confirm",p.token)).toMatchObject({ok:false,status:"expired"});noMutation();
});
test("a fresh background lifetime has no persisted-plan listener",async()=>{
 await command();const old=await plan();await setup();const reply=vi.fn();receiver({type:"preview:get",token:old.token},{id:"fixture",url:apiURL("preview.html")+"?token="+old.token,tab:tab(90)},reply);expect(reply).not.toHaveBeenCalled();noMutation();expect(old.targets).toHaveLength(1);
});
test("active keeper retains the original requesting tab rather than the preview tab",async()=>{
 mock.data.duplicate_keep="active";await command();expect((await plan()).targets.map(t=>t.id)).toEqual([2]);await message("preview:confirm");expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2]);
});
test("default-off preserves immediate operation and opens no preview",async()=>{
 mock.data.preview_before=false;await command();expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);expect((mock.api.tabs as PreviewTabs).create).not.toHaveBeenCalled();
});
test.each(["02_execute_option1","05_execute_option11_d","06_execute_option12_d","03_execute_option3","04_execute_option4"])("%s dry-run does not close/move/group/reload",async name=>{
 tabs[1]!.windowId=2;tabs[1]!.discarded=true;await command(name);expect((await plan()).targets.length).toBeGreaterThanOrEqual(0);noMutation();
});
test("action and context menu use the same opt-in preview boundary",async()=>{
 await mock.clicked.emit();expect((await plan()).targets[0]?.reasons).toContain("duplicate");noMutation();await message("preview:cancel");tabs=tabs.filter(t=>t.id!==90);tabs[0]!.active=true;
 await mock.menuClicked.emit({menuItemId:"ohmytab_close_tabs",editable:false},tabs[0]!);expect((await plan()).targets.map(t=>t.id)).toEqual([1,2]);expect((await plan()).targets[0]?.reasons).toEqual(["sameDomain"]);noMutation();
});

test("tab addition while confirmation settings read is delayed is revalidated before mutation",async()=>{
 await command();let entered=false;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 mock.api.storage.sync.get.mockImplementationOnce((defaults,cb)=>{entered=true;const data={...defaults,...mock.data};if(target==="chrome"){void gate.then(()=>cb?.(data));return;}return gate.then(()=>data);});
 const confirming=message("preview:confirm");await vi.waitFor(()=>expect(entered).toBe(true));tabs.push(tab(4));release();expect((await confirming).ok).toBe(false);noMutation();
});
test("a related tab added during one confirmed reload prevents subsequent mutations",async()=>{
 mock.data.depclean=false;tabs[0]!.discarded=true;tabs[1]!.discarded=true;await command("04_execute_option4");
 mock.api.tabs.reload.mockImplementationOnce(async()=>{tabs.push(tab(4));});
 const reply=await message("preview:confirm");expect(reply.ok).toBe(false);expect(mock.api.tabs.reload).toHaveBeenCalledExactlyOnceWith(1);expect(mock.api.tabs.remove).not.toHaveBeenCalled();expect(mock.api.tabs.move).not.toHaveBeenCalled();
});
test.skipIf(target!=="chrome")("new group member appearing inside the final group query is never moved",async()=>{
 mock.data.depclean=false;mock.data.grouping=true;tabs[0]!.groupId=7;tabs[1]!.groupId=7;tabs[0]!.index=2;tabs[1]!.index=3;
 (mock.api as PreviewApi).tabGroups.query.mockResolvedValue([{id:7,title:"same.example"}]);
 tabs.push(tab(4,"https://other.example/",{index:0}));await mock.clicked.emit();const p=await plan();expect(p.targets.map(t=>t.id)).toEqual([1,2]);noMutation();
 const query=mock.api.tabs.query.getMockImplementation()!;
 mock.api.tabs.query.mockImplementation(async value=>{const q=value as chrome.tabs.QueryInfo;if(q.groupId===7){tabs.push(tab(5,"https://same.example/a",{groupId:7,index:4}));}return query(value);});
 const reply=await message("preview:confirm");expect(reply.ok).toBe(false);expect((mock.api as PreviewApi).tabGroups.move).not.toHaveBeenCalled();expect(mock.api.tabs.move).not.toHaveBeenCalled();expect(mock.api.tabs.remove).not.toHaveBeenCalled();
});

test.skipIf(target!=="firefox")("Firefox cookieStore change refuses the old confirmed IDs",async()=>{
 await command();(tabs[0] as chrome.tabs.Tab & {cookieStoreId:string}).cookieStoreId="firefox-container-7";
 const reply=await message("preview:confirm");expect(reply.ok).toBe(false);noMutation();
});
