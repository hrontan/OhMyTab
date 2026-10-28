import { initializePageText, message, sendPageRequest, setText as text } from "./page-runtime";
import type {UndoEntry} from "../operations/undo";
type Reply = {ok: boolean; busy?: boolean; entries?: UndoEntry[]; expiresAt?: number; restored?: number; failed?: number; unknown?: number; status?: string};
const request = async(type: string, keys?: string[]): Promise<Reply> => {
  const result = await sendPageRequest({type,keys}, "Undo unavailable");
  return result as Reply;
};
document.addEventListener("DOMContentLoaded",() => {
  initializePageText("undoTitle");
  let current:UndoEntry[]=[], expiryTimer:ReturnType<typeof setTimeout>|undefined;
  const disable=()=>document.querySelectorAll<HTMLButtonElement>("button").forEach(button=>{button.disabled=true;});
  const render=(reply:Reply) => {
    clearTimeout(expiryTimer); current=reply.entries??[];
    const list=document.querySelector("#entries")!;list.replaceChildren();
    for(const entry of current){
      const li=document.createElement("li"),url=document.createElement("span"),restore=document.createElement("button"),remove=document.createElement("button");
      url.className="url";url.textContent=entry.url+" ("+message("undoWindow")+": "+entry.windowId+", "+message("undoIndex")+": "+entry.index+")";li.appendChild(url);
      restore.type="button";restore.textContent=message("undoRestore");restore.disabled=!!reply.busy||entry.state==="unknown";
      restore.addEventListener("click",()=>{void action("undo:restore",[entry.key]);});
      remove.type="button";remove.textContent=message("undoDelete");remove.disabled=!!reply.busy;remove.addEventListener("click",()=>{void action("undo:delete",[entry.key]);});
      li.append(restore,remove);if(entry.state==="unknown"){const state=document.createElement("span");state.textContent=message("undoUnknown");li.appendChild(state);}list.appendChild(li);
    }
    document.querySelector<HTMLButtonElement>("#restore_all")!.disabled=!!reply.busy||!current.some(entry=>entry.state==="ready");
    document.querySelector<HTMLButtonElement>("#clear_all")!.disabled=!!reply.busy||!current.length;
    document.querySelector<HTMLButtonElement>("#refresh")!.disabled=!!reply.busy;
    text("#expires",reply.expiresAt?message("undoExpires")+": "+new Date(reply.expiresAt).toLocaleString(document.documentElement.lang):"");
    if(reply.expiresAt)expiryTimer=setTimeout(()=>{void load();},Math.max(0,reply.expiresAt-Date.now()));
  };
  const load=async()=>{
    disable();try{const reply=await request("undo:get");render(reply);text("#status",reply.ok?(reply.entries?.length?"":message("undoEmpty")):message("undoUnavailable"));}
    catch{render({ok:false});text("#status",message("undoUnavailable"));}
  };
  const action=async(type:string,keys?:string[])=>{
    disable();text("#status",message("undoWorking"));
    try{const reply=await request(type,keys);render(reply);
      text("#status",!reply.ok?message("undoUnavailable"):type==="undo:restore"
        ? message("undoRestored")+": "+(reply.restored??0)+", "+message("undoFailed")+": "+(reply.failed??0)+", "+message("undoUnknown")+": "+(reply.unknown??0)
        :message("undoDeleted"));
    }catch{await load();text("#status",message("undoUnavailable"));}
  };
  document.querySelector("#restore_all")!.addEventListener("click",()=>{void action("undo:restore",current.filter(entry=>entry.state==="ready").map(entry=>entry.key));});
  document.querySelector("#clear_all")!.addEventListener("click",()=>{void action("undo:clear");});
  document.querySelector("#refresh")!.addEventListener("click",()=>{void load();});
  void load();
});
