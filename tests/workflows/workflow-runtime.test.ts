import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser } from "../helpers/settings-browser";
import type { BrowserTarget } from "../helpers/browser";
import type { WorkflowDraft, WorkflowInput, WorkflowInspection, WorkflowStore } from "../../src/workflows/workflow-types";
import type { PreviewPlan } from "../../src/operations/operation-plan";
import { draft, ruleId } from "./fixtures";
const target=process.env.TEST_BROWSER as BrowserTarget;
type Reply={ok:boolean;status?:string;inspection?:WorkflowInspection;store?:WorkflowStore;plan?:PreviewPlan;origins?:{tabId:number}[]};
type Receiver=(message:unknown,sender:chrome.runtime.MessageSender,reply:(value:Reply)=>void)=>unknown;
let mock:ReturnType<typeof installSettingsBrowser>, tabs:chrome.tabs.Tab[], listeners:Receiver[];
let runtime:ReturnType<typeof import("../../src/operations/operation-runtime").createOperationRuntime>;
let create:ReturnType<typeof vi.fn<(details:{url:string;windowId:number})=>Promise<chrome.tabs.Tab>>>, settled:ReturnType<typeof vi.fn<()=>Promise<void>>>;
const editorId="22222222-2222-4222-8222-222222222222";
const url=(name:string)=>"chrome-extension://fixture/"+name;
const tab=(id:number,address="https://example.com/a",extra:Partial<chrome.tabs.Tab>={})=>({id,url:address,title:"Tab "+id,index:id-1,windowId:1,active:id===1,pinned:false,incognito:false,groupId:-1,discarded:false,...(target==="firefox"?{cookieStoreId:"firefox-default"}:{}),...extra}) as chrome.tabs.Tab;
const origin={tabId:1,windowId:1};
const request=(value:WorkflowDraft=draft(),rev=0)=>({editorId,draftRevision:rev,origin,draft:value,expectedStoreRevision:(mock.localData.saved_workflows_v1 as WorkflowStore | undefined)?.revision ?? 0});
async function setup(){
 vi.resetModules();mock=installSettingsBrowser(target);listeners=[];tabs=[tab(1,"https://keep.test/"),tab(2),tab(3,"https://example.com/protected",{pinned:true}),tab(80,url("options.html")),tab(81,url("undo.html?q=1"))];
 Object.assign(mock.data,{preview_before:false,protect_domains:"",protect_audible:true,protect_groups:true});
 Object.assign(mock.runtime,{id:"fixture",getURL:url,onMessage:{addListener:vi.fn((fn:Receiver)=>listeners.push(fn))}});
 mock.api.tabs.query.mockImplementation(async value=>{const q=value as chrome.tabs.QueryInfo;return tabs.filter(t=>(q.pinned==null||t.pinned===q.pinned)&&(!q.active||t.active)&&(q.windowId==null||t.windowId===q.windowId)).map(t=>({...t}));});
 mock.api.tabs.get.mockImplementation(async id=>{const t=tabs.find(t=>t.id===id);if(!t)throw Error("Missing");return {...t,id,status:"complete"};});
 mock.api.tabs.remove.mockImplementation(async ids=>{tabs=tabs.filter(t=>!ids.includes(t.id!));});
 mock.api.windows.getAll.mockResolvedValue([{id:1,incognito:false,type:"normal"},{id:2,incognito:false,type:"normal"}] as chrome.windows.Window[]);
 create=vi.fn(async(details:{url:string;windowId:number})=>{tabs.forEach(t=>{t.active=false;});const item=tab(90,details.url,{windowId:details.windowId,active:true});tabs.push(item);return item;});
 Object.assign(mock.api.tabs,{create,group:vi.fn(async()=>1),ungroup:vi.fn(async()=>{})});Object.assign(mock.api,{tabGroups:{query:vi.fn(async()=>[]),move:vi.fn(async()=>{}),update:vi.fn(async()=>{})}});
 settled=vi.fn(async()=>{});runtime=(await import("../../src/operations/operation-runtime")).createOperationRuntime({refreshBadge:vi.fn(async()=>{}),onSettled:settled});
 (await import("../../src/workflows/workflow-service")).registerWorkflowMessages(runtime);
}
beforeEach(setup);afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
async function send(message:unknown,patch:Partial<chrome.runtime.MessageSender>={}){return new Promise<Reply>(resolve=>{for(const receiver of [...listeners])receiver(message,{id:"fixture",url:url("options.html"),tab:tabs.find(t=>t.id===80)!,...patch},resolve);});}
async function previewMessage(type:string,patch:Partial<chrome.runtime.MessageSender>={}){const address=create.mock.calls.at(-1)![0].url;return send({type,token:new URL(address).searchParams.get("token")},{url:address,tab:tabs.find(t=>t.id===90)!,...patch});}
const noMutations=()=>{expect(mock.api.tabs.remove).not.toHaveBeenCalled();expect(mock.api.tabs.move).not.toHaveBeenCalled();expect(mock.api.tabs.reload).not.toHaveBeenCalled();expect(mock.api.windows.create).not.toHaveBeenCalled();};
async function rulePreview(value=draft()){expect(await send({type:"workflow:preview-rule",...request(value),ruleId})).toEqual({ok:true,status:"preview"});}
async function save(value=draft()){const reply=await send({type:"workflow:create",expectedRevision:0,draft:value});expect(reply.ok).toBe(true);return reply.store!;}
async function savedPreview(value=draft()){const store=await save(value), item=store.workflows[0]!;expect(await send({type:"workflow:preview-saved",origin,id:item.id,expectedRevision:store.revision,expectedWorkflowRevision:item.revision})).toEqual({ok:true,status:"preview"});return store;}
test("inspection is side-effect-free, includes pinned exclusions and excludes every extension page",async()=>{const d=draft();d.rules[0]!.condition={kind:"contains",value:"/"} as never;const reply=await send({type:"workflow:inspect",...request(d)});expect(reply.ok).toBe(true);expect(reply.inspection).toMatchObject({candidateCount:3,targetCount:2,excludedCount:1});expect(reply.inspection!.targets.map(t=>t.id)).toEqual([1,2]);expect(reply.inspection!.excluded[0]!.reasons).toEqual(["pinned"]);noMutations();expect(create).not.toHaveBeenCalled();expect(mock.api.storage.local.set).not.toHaveBeenCalled();expect(mock.api.storage.sync.set).not.toHaveBeenCalled();expect(settled).not.toHaveBeenCalled();expect(mock.api.action.setTitle).not.toHaveBeenCalled();expect(mock.api.windows.getLastFocused).not.toHaveBeenCalled();});
test("rule-only ignores every global and workflow operation and other rules, including disabled selected rule",async()=>{Object.assign(mock.data,{glue:true,depclean:true,sorttab:true,refresh:true,comclose:true,rxclose:true,closelocal:true,grouping:true,urlmatch:true,urlmatch_pattern:"keep.test"});const d=draft();d.scope="all";Object.assign(d.operations,{glue:true,depclean:true,sorttab:true,refresh:true,comclose:true,rxclose:true,closelocal:true,grouping:true});d.rules[0]!.enabled=false;d.rules.push({...d.rules[0]!,id:crypto.randomUUID(),enabled:true,condition:{kind:"host",value:"keep.test",includeSubdomains:true}});tabs[0]!.discarded=true;await rulePreview(d);expect((await previewMessage("preview:get")).plan!.targets.map(t=>t.id)).toEqual([2]);noMutations();expect(await previewMessage("preview:confirm")).toMatchObject({ok:true,status:"complete"});expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2]);expect(mock.api.tabs.move).not.toHaveBeenCalled();expect(mock.api.tabs.reload).not.toHaveBeenCalled();expect(mock.api.storage.sync.set).not.toHaveBeenCalled();});
test("saved execution always previews with global preview disabled; global fingerprint differs from effective flags safely",async()=>{await savedPreview();noMutations();expect(await previewMessage("preview:confirm")).toMatchObject({ok:true,status:"complete"});expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2]);expect(mock.data.preview_before).toBe(false);});
test.each(["draft","same-revision-content","origin-move","origin-close","origin-session","origin-url","options-close","global","url","audible","pinned","added","window-type"])("%s invalidates a rule plan",async change=>{await rulePreview();if(change==="draft")expect(await send({type:"workflow:draft-changed",editorId,draftRevision:1})).toEqual({ok:true});if(change==="same-revision-content")expect((await send({type:"workflow:inspect",...request({...draft(),name:"Different"})})).ok).toBe(false);if(change==="origin-move")tabs[0]!.windowId=2;if(change==="origin-close")tabs=tabs.filter(t=>t.id!==1);if(change==="origin-session")tabs[0]!.incognito=true;if(change==="origin-url")tabs[0]!.url="https://moved.test/";if(change==="options-close")tabs=tabs.filter(t=>t.id!==80);if(change==="global")mock.data.protect_domains="example.com";if(change==="url")tabs[1]!.url="https://changed.test/";if(change==="audible")tabs[1]!.audible=true;if(change==="pinned")tabs[1]!.pinned=true;if(change==="added")tabs.push(tab(4));if(change==="window-type")mock.api.windows.getAll.mockResolvedValue([{id:1,type:"popup",incognito:false}] as chrome.windows.Window[]);if(change==="same-revision-content")return;expect((await previewMessage("preview:confirm")).ok).toBe(false);noMutations();});
test("saved source revision changes are checked without relying on onChanged delivery",async()=>{const store=await savedPreview();mock.localData.saved_workflows_v1={...store,revision:2};expect((await previewMessage("preview:confirm")).ok).toBe(false);noMutations();});
test("local change event invalidates saved tokens",async()=>{await savedPreview();await mock.changed.emit({saved_workflows_v1:{newValue:{}}},"local");expect(await previewMessage("preview:get")).toMatchObject({ok:false,status:"expired"});});
test("new draft invalidation while settings read is delayed prevents mutation",async()=>{await rulePreview();let entered=false;let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});mock.api.storage.sync.get.mockImplementationOnce((defaults,cb)=>{entered=true;const result={...defaults,...mock.data};if(target==="chrome"){void gate.then(()=>cb?.(result));return;}return gate.then(()=>result);});const confirming=previewMessage("preview:confirm");await vi.waitFor(()=>expect(entered).toBe(true));await send({type:"workflow:draft-changed",editorId,draftRevision:1});release();expect((await confirming).ok).toBe(false);noMutations();});
test("a saved revision change between reload mutations stops subsequent mutations",async()=>{const d=draft();d.rules=[];d.operations.refresh=true;tabs[1]!.discarded=true;tabs.push(tab(4,"https://other.test/",{discarded:true}));const store=await savedPreview(d);mock.api.tabs.reload.mockImplementationOnce(async()=>{mock.localData.saved_workflows_v1={...store,revision:store.revision+1};});expect((await previewMessage("preview:confirm")).ok).toBe(false);expect(mock.api.tabs.reload).toHaveBeenCalledExactlyOnceWith(2);});
test("strict sender, shape and explicit origin reject fallback selection",async()=>{for(const patch of [{id:"other"},{url:url("options.html?x")},{tab:{} as chrome.tabs.Tab},{tab:tab(80,url("options.html"),{windowId:2})}])expect((await send({type:"workflow:list"},patch)).ok).toBe(false);for(const message of [{type:"workflow:list",extra:true},{type:"workflow:execute"},{type:"workflow:inspect",...request(),origin:{tabId:81,windowId:1}},{type:"workflow:inspect",...request(),origin:{tabId:1,windowId:2}},{type:"workflow:create",draft:draft(),expectedRevision:"0"}])expect((await send(message)).ok).toBe(false);noMutations();expect(mock.api.windows.getLastFocused).not.toHaveBeenCalled();});
test("context returns only same-window session ordinary tabs",async()=>{tabs.push(tab(4,"https://private.test/",{incognito:true}),tab(5,"https://window.test/",{windowId:2}));expect((await send({type:"workflow:context"})).origins!.map(t=>t.tabId)).toEqual([1,2,3]);});
test("live protection and zero targets create no confirmation page",async()=>{mock.data.protect_domains="example.com";expect(await send({type:"workflow:preview-rule",...request(),ruleId})).toEqual({ok:true,status:"empty"});expect(create).not.toHaveBeenCalled();noMutations();});
test("double confirmation consumes only once and TTL rejects expired token",async()=>{await rulePreview();const replies=await Promise.all([previewMessage("preview:confirm"),previewMessage("preview:confirm")]);expect(replies.map(r=>r.ok).sort()).toEqual([false,true]);expect(mock.api.tabs.remove).toHaveBeenCalledTimes(1);await setup();await rulePreview();const plan=(await previewMessage("preview:get")).plan!;vi.spyOn(Date,"now").mockReturnValue(plan.expiresAt);expect((await previewMessage("preview:confirm")).ok).toBe(false);noMutations();});
test("fresh runtime has no preview token across restart",async()=>{await rulePreview();const address=create.mock.calls.at(-1)![0].url;listeners=[];runtime=(await import("../../src/operations/operation-runtime")).createOperationRuntime({refreshBadge:async()=>{},onSettled:async()=>{}});(await import("../../src/workflows/workflow-service")).registerWorkflowMessages(runtime);const reply=vi.fn();for(const receiver of listeners)expect(receiver({type:"preview:get",token:new URL(address).searchParams.get("token")},{id:"fixture",url:address,tab:tabs.find(t=>t.id===90)!},reply)).toBeUndefined();expect(reply).not.toHaveBeenCalled();noMutations();});
test.skipIf(target!=="firefox")("Firefox rejects missing metadata, cross-container origins and preview container mismatch",async()=>{(tabs[1] as chrome.tabs.Tab & {cookieStoreId:string}).cookieStoreId="firefox-container-2";const context=await send({type:"workflow:context"});expect(context.origins!.map(t=>t.tabId)).toEqual([1,3]);expect((await send({type:"workflow:inspect",...request(),origin:{tabId:2,windowId:1}})).ok).toBe(false);create.mockImplementationOnce(async(details:{url:string;windowId:number})=>tab(90,details.url,{cookieStoreId:"firefox-container-2"} as never));expect(await send({type:"workflow:preview-rule",...request(),ruleId})).toMatchObject({ok:true,status:"empty"});tabs[1]=tab(2);create.mockImplementationOnce(async(details:{url:string;windowId:number})=>tab(90,details.url,{cookieStoreId:"firefox-container-2"} as never));expect(await send({type:"workflow:preview-rule",...request(),ruleId})).toMatchObject({ok:false,status:"unavailable"});noMutations();});
test.skipIf(target!=="firefox")("Firefox saved grouping is unsupported while rule-only remains supported",async()=>{const d=draft();d.operations.grouping=true;const store=await save(d),item=store.workflows[0]!;expect(await send({type:"workflow:preview-saved",origin,id:item.id,expectedRevision:1,expectedWorkflowRevision:1})).toMatchObject({ok:false,status:"unsupported"});await rulePreview(d);});

test("saved duplicate operation preserves original active keeper and reports other actions separately",async()=>{tabs[0]=tab(1,"https://same.test/");tabs[1]=tab(2,"https://same.test/");mock.data.duplicate_keep="active";const d=draft();d.rules=[];d.operations.depclean=true;const inspected=await send({type:"workflow:inspect",...request(d)});expect(inspected.inspection).toMatchObject({candidateCount:0,targetCount:1});expect(inspected.inspection!.targets[0]).toMatchObject({id:2,reasons:["duplicate"],ruleNames:[]});await savedPreview(d);expect((await previewMessage("preview:get")).plan!.targets.map(t=>t.id)).toEqual([2]);expect((await previewMessage("preview:confirm")).ok).toBe(true);expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2]);});
test("all-window rule scope remains in same privacy session and inspection stale replies fail",async()=>{tabs.push(tab(4,"https://example.com/second",{windowId:2}),tab(5,"https://example.com/private",{incognito:true}));const d=draft();d.scope="all";const result=await send({type:"workflow:inspect",...request(d)});expect(result.inspection!.targets.map(t=>t.id)).toEqual([2,4]);await send({type:"workflow:draft-changed",editorId,draftRevision:2});expect(await send({type:"workflow:inspect",...request(d,1)})).toMatchObject({ok:false,status:"stale"});});
test("whole workflow union reports rule closes and other operation reasons; saved revision conflict preserves storage",async()=>{const d=draft();d.operations.refresh=true;tabs[0]!.discarded=true;const reply=await send({type:"workflow:inspect",...request(d)});expect(reply.inspection).toMatchObject({candidateCount:2,targetCount:2,excludedCount:1});expect(reply.inspection!.targets).toEqual(expect.arrayContaining([expect.objectContaining({id:1,reasons:["reload"],ruleNames:[]}),expect.objectContaining({id:2,reasons:["urlRule"],ruleNames:["Example"]})]));await save(d);mock.api.storage.local.set.mockClear();expect(await send({type:"workflow:create",expectedRevision:0,draft:d})).toMatchObject({ok:false,status:"conflict"});expect(mock.api.storage.local.set).not.toHaveBeenCalled();});
test.skipIf(target!=="firefox")("missing Firefox metadata and forged preview container are unavailable",async()=>{delete (tabs[0] as chrome.tabs.Tab & {cookieStoreId?:string}).cookieStoreId;expect((await send({type:"workflow:inspect",...request()})).ok).toBe(false);tabs[0]=tab(1,"https://keep.test/");await rulePreview();expect((await previewMessage("preview:get",{tab:tab(90,url("preview.html"),{cookieStoreId:"firefox-container-9"} as never)})).ok).toBe(false);noMutations();});

test("runtime construction is idle and canonical drafts stay within their instance", async () => {
 const { createOperationRuntime } = await import("../../src/operations/operation-runtime");
 const make = () => createOperationRuntime({ refreshBadge: async () => {}, onSettled: async () => {} });
 const reads = [mock.api.tabs.query, mock.api.tabs.get, mock.api.windows.getAll, mock.api.storage.local.get, mock.api.storage.sync.get, mock.runtime.onMessage.addListener];
 const before = reads.map(read => vi.mocked(read).mock.calls.length);
 const first = make(); const second = make();
 expect(reads.map(read => vi.mocked(read).mock.calls.length)).toEqual(before);
 const input = { ...request(), optionsTabId: 80 };
 await first.inspectWorkflow(input);
 const changed = { ...input, draft: { ...input.draft, name: "Different canonical draft" } };
 await expect(first.inspectWorkflow(changed)).rejects.toMatchObject({ status: "stale" });
 await expect(second.inspectWorkflow(changed)).resolves.toMatchObject({ targetCount: 1 });
 noMutations(); expect(create).not.toHaveBeenCalled();
});

test.each(["missing", "string", "negative", "fraction", "extra", "old"])("strict expectedStoreRevision rejects %s", async variant => {
 const input: Record<string, unknown> = { type: "workflow:inspect", ...request() };
 if (variant === "missing") delete input.expectedStoreRevision;
 if (variant === "string") input.expectedStoreRevision = "0";
 if (variant === "negative") input.expectedStoreRevision = -1;
 if (variant === "fraction") input.expectedStoreRevision = 0.5;
 if (variant === "extra") input.extra = true;
 if (variant === "old") await save();
 expect(await send(input)).toMatchObject({ ok: false, status: variant === "old" ? "stale" : "invalid" });
 noMutations(); expect(create).not.toHaveBeenCalled();
});

test.each(["origin", "rule"])("same revision cannot exchange %s after inspection", async variant => {
 const d = draft(); const second = crypto.randomUUID(); d.rules.push({ ...d.rules[0]!, id: second });
 expect((await send({ type: "workflow:inspect", ...request(d), ruleId })).ok).toBe(true);
 const next = { type: "workflow:preview-rule", ...request(d), ruleId, ...(variant === "origin" ? { origin: { tabId: 2, windowId: 1 } } : { ruleId: second }) };
 expect(await send(next)).toMatchObject({ ok: false, status: "stale" });
 noMutations(); expect(create).not.toHaveBeenCalled();
});

test.each(["update", "delete", "notification"])("draft-rule confirm rejects store %s without relying on UI", async variant => {
 if (variant === "delete") await save();
 await rulePreview();
 const current = mock.localData.saved_workflows_v1 as WorkflowStore | undefined;
 if (variant === "notification") await mock.changed.emit({ saved_workflows_v1: { newValue: {} } }, "local");
 else mock.localData.saved_workflows_v1 = { version: 1, revision: (current?.revision ?? 0) + 1, workflows: [] };
 expect((await previewMessage("preview:confirm")).ok).toBe(false); noMutations();
});

test.each(["inspect", "preview-rule"])("service passes the identical expected revision into %s across a store race", async action => {
 const method = action === "inspect" ? "inspectWorkflow" : "previewWorkflowRule";
 const original = runtime[method].bind(runtime);
 const observed: number[] = [];
 vi.spyOn(runtime, method).mockImplementation(async (input: WorkflowInput) => {
   observed.push(input.expectedStoreRevision);
   mock.localData.saved_workflows_v1 = { version: 1, revision: 1, workflows: [] };
   return original(input as Parameters<typeof runtime.previewWorkflowRule>[0]) as never;
 });
 expect(await send({ type: "workflow:" + action, ...request(), ...(action === "preview-rule" ? { ruleId } : {}) })).toMatchObject({ ok: false, status: "stale" });
 expect(observed).toEqual([0]); noMutations(); expect(create).not.toHaveBeenCalled();
});

test("store change between inspect and preview rejects the original expected revision", async () => {
 const inspected = { ...request(), ruleId };
 expect((await send({ type: "workflow:inspect", ...inspected })).ok).toBe(true);
 await save();
 expect(await send({ type: "workflow:preview-rule", ...inspected })).toMatchObject({ ok: false, status: "stale" });
 noMutations(); expect(create).not.toHaveBeenCalled();
});
