/* Talksy — browser client.
   Stack: HTML/CSS/JS + Supabase Auth, Postgres, Storage and Realtime.
*/
const cfg = window.TALKSY_CONFIG || {};
if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
  console.warn("Add your Supabase URL and anon key in config.js.");
}
if (!window.supabase) {
  console.error("Supabase JS library did not load. Check your internet connection or ad-blocker, and make sure the <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'> tag loads before app.js.");
  document.addEventListener("DOMContentLoaded", () => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;top:0;left:0;right:0;padding:12px;background:#ff4d6d;color:#fff;font:14px system-ui;text-align:center;z-index:9999";
    el.textContent = "Failed to load required library (Supabase JS). Check your internet connection and reload the page.";
    document.body.prepend(el);
  });
  throw new Error("Supabase JS library not found on window.supabase");
}
const { createClient } = window.supabase;
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const state = {
  user: null, profile: null, chats: [], activeChat: null, activeProfile: null,
  messages: [], blocks: [], filter: "all", search: "", pendingFiles: [],
  realtime: null, theme: localStorage.getItem("talksy-theme") || "night"
};

const $ = (id) => document.getElementById(id);
const esc = (s="") => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const fmtTime = (d) => new Date(d).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
const fmtDate = (d) => new Date(d).toLocaleDateString([], {day:"2-digit",month:"short"});
const initials = (name="U") => name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase() || "U";
const normalizePhone = (p) => p.replace(/[^\d+]/g,"").trim();

function toast(msg, type="info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("toastContainer").appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}
function setAvatar(el, profile) {
  if (!el) return;
  if (profile?.avatar_url) el.innerHTML = `<img src="${esc(profile.avatar_url)}" alt="">`;
  else el.textContent = initials(profile?.display_name || "U");
}
function applyTheme() {
  document.body.classList.toggle("light", state.theme === "day");
  $("themeBtn").textContent = state.theme === "day" ? "☀" : "☾";
  localStorage.setItem("talksy-theme", state.theme);
}
function openModal(id){ $(id).classList.remove("hidden"); }
function closeModals(){ document.querySelectorAll(".modal").forEach(x=>x.classList.add("hidden")); $("chatMenu").classList.add("hidden"); }
function showApp(){ $("authScreen").classList.add("hidden"); $("appScreen").classList.remove("hidden"); }
function showAuth(){ $("authScreen").classList.remove("hidden"); $("appScreen").classList.add("hidden"); }

async function init() {
  applyTheme();
  bindEvents();
  const { data } = await sb.auth.getSession();
  if (data.session) await afterLogin(data.session.user);
  else showAuth();
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) await afterLogin(session.user);
    else { state.user=null; showAuth(); }
  });
}
async function afterLogin(user) {
  state.user = user;
  showApp();
  await loadProfile();
  await loadBlocks();
  await loadChats();
  subscribeRealtime();
}
async function loadProfile() {
  const { data, error } = await sb.from("profiles").select("*").eq("id",state.user.id).single();
  if (error) { toast(error.message,"error"); return; }
  state.profile=data;
  $("myName").textContent=data.display_name || "Talksy User";
  $("myPhone").textContent=data.phone || "";
  setAvatar($("myAvatar"),data);
  setAvatar($("profileAvatar"),data);
  $("profileNameInput").value=data.display_name || "";
  $("profilePhoneInput").value=data.phone || "";
}
async function loadBlocks() {
  const { data, error } = await sb.from("blocks").select("id,blocked_id,blocked:profiles!blocks_blocked_id_fkey(id,display_name,phone,avatar_url)").eq("blocker_id",state.user.id);
  if (!error) state.blocks=data || [];
}
function isBlocked(id){ return state.blocks.some(b=>b.blocked_id===id); }

async function loadChats() {
  const { data, error } = await sb.from("chat_members")
    .select("conversation_id,other_user_id,archived,other:profiles!chat_members_other_user_id_fkey(id,display_name,phone,avatar_url)")
    .eq("user_id",state.user.id);
  if (error) { toast(error.message,"error"); return; }

  const convIds=(data||[]).map(x=>x.conversation_id);
  let lastMap={}, unreadMap={};
  if(convIds.length){
    const { data:last }=await sb.from("messages").select("conversation_id,body,media_type,created_at,sender_id").in("conversation_id",convIds).order("created_at",{ascending:false});
    (last||[]).forEach(m=>{ if(!lastMap[m.conversation_id]) lastMap[m.conversation_id]=m; });
    const { data:reads }=await sb.from("chat_reads").select("conversation_id,last_read_at").eq("user_id",state.user.id);
    (reads||[]).forEach(r=>{
      const last=lastMap[r.conversation_id];
      unreadMap[r.conversation_id]=!!(last && last.sender_id!==state.user.id && new Date(last.created_at)>new Date(r.last_read_at));
    });
  }
  state.chats=(data||[]).map(c=>({...c,last:lastMap[c.conversation_id],unread:unreadMap[c.conversation_id]}));
  renderChatList();
}
function renderChatList() {
  const q=state.search.toLowerCase();
  let list=state.chats.filter(c=>{
    const p=c.other||{};
    const matches=!q || `${p.display_name||""} ${p.phone||""}`.toLowerCase().includes(q);
    const filter=state.filter==="all" || (state.filter==="unread" ? c.unread : !c.unread);
    return matches && filter && !c.archived;
  });
  $("chatList").innerHTML=list.length ? list.map(c=>{
    const p=c.other;
    const last=c.last;
    let preview=last ? (last.media_type ? `📎 ${last.body||"Media"}` : (last.body||"")) : "No messages yet";
    return `<button class="chat-item ${state.activeChat?.conversation_id===c.conversation_id?"active":""}" data-conv="${c.conversation_id}">
      <div class="avatar">${p?.avatar_url?`<img src="${esc(p.avatar_url)}" alt="">`:esc(initials(p?.display_name))}</div>
      <div class="chat-main"><div class="chat-line"><strong>${esc(p?.display_name||p?.phone||"Unknown")}</strong><time>${last?fmtDate(last.created_at):""}</time></div>
      <div class="last-message">${esc(preview)}</div></div>${c.unread?'<span class="unread-dot"></span>':""}
    </button>`;
  }).join("") : `<div class="no-results">No chats found.</div>`;
  document.querySelectorAll(".chat-item").forEach(b=>b.onclick=()=>openChat(b.dataset.conv));
}
async function openChat(conversationId) {
  const chat=state.chats.find(c=>c.conversation_id===conversationId);
  if(!chat) return;
  if(isBlocked(chat.other_user_id)){ toast("This user is blocked. Unblock them to continue.","error"); return; }
  state.activeChat=chat; state.activeProfile=chat.other;
  $("emptyState").classList.add("hidden"); $("conversationView").classList.remove("hidden");
  $("appScreen").classList.add("chat-open");
  $("activeName").textContent=chat.other.display_name || chat.other.phone;
  $("activePhone").textContent=chat.other.phone;
  setAvatar($("activeAvatar"),chat.other);
  renderChatList();
  await loadMessages();
  await markRead();
}
async function loadMessages() {
  if(!state.activeChat)return;
  const { data,error }=await sb.from("messages").select("*").eq("conversation_id",state.activeChat.conversation_id).order("created_at",{ascending:true});
  if(error){toast(error.message,"error");return}
  state.messages=data||[];
  renderMessages();
}
function renderMessages() {
  const q=$("messageSearchInput").value.trim().toLowerCase();
  const arr=state.messages.filter(m=>!q || (m.body||"").toLowerCase().includes(q));
  let html="", day="";
  for(const m of arr){
    const d=fmtDate(m.created_at);
    if(d!==day){day=d;html+=`<div class="day-label">${esc(d)}</div>`}
    const mine=m.sender_id===state.user.id;
    html+=`<div class="message-row ${mine?"mine":""}"><div class="bubble">
      ${renderMessageContent(m)}
      <div class="bubble-meta">${fmtTime(m.created_at)} ${mine?(m.read_at?"✓✓":"✓"):""}</div>
    </div></div>`;
  }
  $("messages").innerHTML=html || `<div class="no-results">No messages yet. Say hello 👋</div>`;
  $("messages").scrollTop=$("messages").scrollHeight;
}
function renderMessageContent(m){
  if(!m.media_url) return `<div class="bubble-text">${esc(m.body||"")}</div>`;
  const name=esc(m.file_name||"Media");
  const type=m.media_type||"";
  if(type.startsWith("image/")) return `<a class="media-card" href="${esc(m.media_url)}" target="_blank" rel="noopener"><img src="${esc(m.media_url)}" alt="${name}" loading="lazy"></a>${m.body?`<div class="bubble-text">${esc(m.body)}</div>`:""}`;
  if(type.startsWith("video/")) return `<a class="media-card" href="${esc(m.media_url)}" target="_blank" rel="noopener"><video src="${esc(m.media_url)}" controls></video></a>${m.body?`<div class="bubble-text">${esc(m.body)}</div>`:""}`;
  if(type.startsWith("audio/")) return `<div class="file-card"><span class="file-icon">🎵</span><a href="${esc(m.media_url)}" target="_blank" rel="noopener" class="file-name">${name}</a></div>${m.body?`<div class="bubble-text">${esc(m.body)}</div>`:""}`;
  return `<a class="media-card file-card" href="${esc(m.media_url)}" target="_blank" rel="noopener"><span class="file-icon">📄</span><span class="file-name">${name}</span></a>${m.body?`<div class="bubble-text">${esc(m.body)}</div>`:""}`;
}
async function markRead(){
  if(!state.activeChat)return;
  await sb.from("chat_reads").upsert({user_id:state.user.id,conversation_id:state.activeChat.conversation_id,last_read_at:new Date().toISOString()},{onConflict:"user_id,conversation_id"});
  const c=state.chats.find(x=>x.conversation_id===state.activeChat.conversation_id);if(c)c.unread=false;
  renderChatList();
}
async function sendText(body, files) {
  if(!state.activeChat)return;
  if(isBlocked(state.activeProfile.id)){toast("Unblock this user before sending.","error");return}
  const inserts=[];
  for(const file of files||[]){
    try{
      const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      const path=`${state.user.id}/${state.activeChat.conversation_id}/${crypto.randomUUID()}-${safe}`;
      const {error:upErr}=await sb.storage.from("talksy-media").upload(path,file,{upsert:false,contentType:file.type||"application/octet-stream"});
      if(upErr) throw upErr;
      const {data:urlData}=sb.storage.from("talksy-media").getPublicUrl(path);
      inserts.push({conversation_id:state.activeChat.conversation_id,sender_id:state.user.id,body:body||null,media_url:urlData.publicUrl,media_type:file.type||"application/octet-stream",file_name:file.name});
    }catch(e){toast(`Upload failed: ${e.message}`,"error");return}
  }
  if(!files?.length && body.trim()) inserts.push({conversation_id:state.activeChat.conversation_id,sender_id:state.user.id,body:body.trim()});
  if(!inserts.length)return;
  const {error}=await sb.from("messages").insert(inserts);
  if(error){toast(error.message,"error");return}
  $("messageInput").value=""; state.pendingFiles=[]; renderUploadPreview(); await loadMessages(); await loadChats();
}
async function createConversation(otherId){
  const a=state.user.id,b=otherId;
  const user1=a<b?a:b, user2=a<b?b:a;
  const {data,error}=await sb.from("conversations").upsert({user1,user2},{onConflict:"user1,user2"}).select().single();
  if(error){toast(error.message,"error");return null}
  await sb.from("chat_members").upsert([
    {conversation_id:data.id,user_id:a,other_user_id:b},
    {conversation_id:data.id,user_id:b,other_user_id:a}
  ],{onConflict:"conversation_id,user_id"});
  return data.id;
}
async function searchUsers(phone){
  const q=normalizePhone(phone);
  if(!q){$("userSearchResults").innerHTML="";return}
  const {data,error}=await sb.from("profiles").select("id,display_name,phone,avatar_url").ilike("phone",`${q}%`).neq("id",state.user.id).limit(10);
  if(error){toast(error.message,"error");return}
  $("userSearchResults").innerHTML=data?.length ? data.map(p=>`<button class="user-result" data-user="${p.id}">
    <div class="avatar">${p.avatar_url?`<img src="${esc(p.avatar_url)}" alt="">`:esc(initials(p.display_name))}</div>
    <div class="result-info"><strong>${esc(p.display_name||"Talksy user")}</strong><span>${esc(p.phone)}</span></div>
    <span>›</span></button>`).join("") : `<div class="no-results">No registered user found.</div>`;
  document.querySelectorAll(".user-result").forEach(x=>x.onclick=async()=>{
    const id=x.dataset.user; const conv=await createConversation(id); if(conv){closeModals();await loadChats();openChat(conv);}
  });
}
async function saveProfile(){
  const name=$("profileNameInput").value.trim();
  if(!name){toast("Name is required","error");return}
  const {error}=await sb.from("profiles").update({display_name:name}).eq("id",state.user.id);
  if(error){toast(error.message,"error");return}
  await loadProfile();await loadChats();closeModals();toast("Profile updated","success");
}
async function uploadDP(file){
  if(!file)return;
  const path=`avatars/${state.user.id}-${Date.now()}.${(file.name.split(".").pop()||"jpg").toLowerCase()}`;
  const {error}=await sb.storage.from("talksy-media").upload(path,file,{upsert:true,contentType:file.type});
  if(error){toast(error.message,"error");return}
  const {data}=sb.storage.from("talksy-media").getPublicUrl(path);
  const {error:dbErr}=await sb.from("profiles").update({avatar_url:data.publicUrl}).eq("id",state.user.id);
  if(dbErr){toast(dbErr.message,"error");return}
  await loadProfile();await loadChats();toast("DP updated","success");
}
async function saveContactName(){
  if(!state.activeProfile)return;
  const current=state.activeProfile;
  const name=prompt("Saved name for this contact:",current.display_name||"");
  if(name===null)return;
  const trimmed=name.trim();if(!trimmed)return;
  const {error}=await sb.from("contacts").upsert({owner_id:state.user.id,contact_id:current.id,saved_name:trimmed},{onConflict:"owner_id,contact_id"});
  if(error){toast(error.message,"error");return}
  state.activeProfile={...current,display_name:trimmed};
  if(state.activeChat)state.activeChat.other=state.activeProfile;
  $("activeName").textContent=trimmed;await loadChats();toast("Saved name updated","success");
}
async function archiveChat(){
  if(!state.activeChat)return;
  const {error}=await sb.from("chat_members").update({archived:true}).eq("conversation_id",state.activeChat.conversation_id).eq("user_id",state.user.id);
  if(error)toast(error.message,"error");else{toast("Chat archived","success");closeConversation();await loadChats()}
}
async function clearChat(){
  if(!state.activeChat||!confirm("Clear all messages in this chat? This affects both participants."))return;
  const {error}=await sb.from("messages").delete().eq("conversation_id",state.activeChat.conversation_id);
  if(error)toast(error.message,"error");else{toast("Chat cleared","success");await loadMessages();await loadChats()}
}
async function deleteChat(){
  if(!state.activeChat||!confirm("Delete this chat for you? The other person can still have their copy."))return;
  const {error}=await sb.from("chat_members").delete().eq("conversation_id",state.activeChat.conversation_id).eq("user_id",state.user.id);
  if(error)toast(error.message,"error");else{toast("Chat deleted","success");closeConversation();await loadChats()}
}
async function toggleBlock(){
  if(!state.activeProfile)return;
  if(isBlocked(state.activeProfile.id)){
    const {error}=await sb.from("blocks").delete().eq("blocker_id",state.user.id).eq("blocked_id",state.activeProfile.id);
    if(error)toast(error.message,"error");else{toast("User unblocked","success");await loadBlocks()}
  }else{
    const {error}=await sb.from("blocks").insert({blocker_id:state.user.id,blocked_id:state.activeProfile.id});
    if(error)toast(error.message,"error");else{toast("User blocked","success");await loadBlocks();closeConversation()}
  }
}
async function renderBlockList(){
  await loadBlocks();
  $("blockList").innerHTML=state.blocks.length?state.blocks.map(b=>`<div class="block-item">
    <div class="avatar">${b.blocked?.avatar_url?`<img src="${esc(b.blocked.avatar_url)}">`:esc(initials(b.blocked?.display_name))}</div>
    <div class="result-info"><strong>${esc(b.blocked?.display_name||"User")}</strong><span>${esc(b.blocked?.phone||"")}</span></div>
    <button class="secondary-btn unblock-btn" data-id="${b.blocked_id}">Unblock</button>
  </div>`).join(""):`<div class="no-results">Your block list is empty.</div>`;
  document.querySelectorAll(".unblock-btn").forEach(btn=>btn.onclick=async()=>{
    await sb.from("blocks").delete().eq("blocker_id",state.user.id).eq("blocked_id",btn.dataset.id);
    await renderBlockList();await loadChats();
  });
}
function closeConversation(){
  state.activeChat=null;state.activeProfile=null;$("conversationView").classList.add("hidden");$("emptyState").classList.remove("hidden");$("appScreen").classList.remove("chat-open");
}
function renderUploadPreview(){
  $("uploadPreview").classList.toggle("hidden",!state.pendingFiles.length);
  $("uploadPreview").innerHTML=state.pendingFiles.map((f,i)=>`<div class="upload-chip">📎 ${esc(f.name)} <button type="button" data-i="${i}">×</button></div>`).join("");
  $("uploadPreview").querySelectorAll("button").forEach(b=>b.onclick=()=>{state.pendingFiles.splice(+b.dataset.i,1);renderUploadPreview()});
}
function subscribeRealtime(){
  if(state.realtime) sb.removeChannel(state.realtime);
  state.realtime=sb.channel(`talksy-${state.user.id}`)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},async payload=>{
      if(state.activeChat?.conversation_id===payload.new.conversation_id){await loadMessages();await markRead()}else await loadChats();
    })
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages"},async()=>{if(state.activeChat)await loadMessages();})
    .subscribe();
}
function bindEvents(){
  document.querySelectorAll("[data-auth-tab]").forEach(btn=>btn.onclick=()=>{
    document.querySelectorAll(".auth-tab").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
    $("loginForm").classList.toggle("hidden",btn.dataset.authTab!=="login");$("signupForm").classList.toggle("hidden",btn.dataset.authTab!=="signup");
  });
  document.querySelectorAll(".password-toggle").forEach(b=>b.onclick=()=>{const i=$(b.dataset.target);i.type=i.type==="password"?"text":"password";b.textContent=i.type==="password"?"Show":"Hide"});
  $("loginForm").onsubmit=async e=>{
    e.preventDefault();
    const email=$("loginEmail").value.trim();
    try{
      const {data,error}=await sb.auth.signInWithPassword({email,password:$("loginPassword").value});
      if(error){console.error("Login error:",error);toast(error.message,"error");}
      else if(data.user)toast("Welcome back","success");
    }catch(err){console.error("Login exception:",err);toast(err.message||"Login failed. Check console for details.","error");}
  };
  $("signupForm").onsubmit=async e=>{
    e.preventDefault();
    const email=$("signupEmail").value.trim(),phone=normalizePhone($("signupPhone").value),name=$("signupName").value.trim(),password=$("signupPassword").value;
    if(!phone){toast("Phone number is required","error");return}
    if(!cfg.SUPABASE_URL||cfg.SUPABASE_URL.includes("YOUR-PROJECT")){toast("Supabase is not configured. Check config.js.","error");return}
    try{
      const {data,error}=await sb.auth.signUp({email,password,options:{data:{display_name:name,phone}}});
      if(error){console.error("Signup error:",error);toast(error.message,"error");}
      else if(data.session){toast("Account created","success");}
      else toast("Account created. If Supabase asks you to confirm your email, check your inbox — or disable email confirmation in Authentication settings for instant login.","info");
    }catch(err){console.error("Signup exception:",err);toast(err.message||"Sign up failed. Check console for details.","error");}
  };
  $("themeBtn").onclick=()=>{state.theme=state.theme==="day"?"night":"day";applyTheme()};
  $("profileBtn").onclick=()=>openModal("profileModal");
  document.querySelectorAll(".close-modal").forEach(b=>b.onclick=closeModals);
  document.querySelectorAll(".modal").forEach(m=>m.onclick=e=>{if(e.target===m)m.classList.add("hidden")});
  $("newChatBtn").onclick=()=>{openModal("newChatModal");$("userSearchInput").focus()};
  $("userSearchInput").oninput=e=>searchUsers(e.target.value);
  $("blockListBtn").onclick=async()=>{openModal("blockListModal");await renderBlockList()};
  $("saveProfileBtn").onclick=saveProfile;
  $("dpInput").onchange=e=>uploadDP(e.target.files[0]);
  $("chatSearch").oninput=e=>{state.search=e.target.value;renderChatList()};
  document.querySelectorAll(".filter-btn").forEach(b=>b.onclick=()=>{document.querySelectorAll(".filter-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.filter=b.dataset.filter;renderChatList()});
  $("attachBtn").onclick=()=>$("mediaInput").click();
  $("mediaInput").onchange=e=>{state.pendingFiles=[...state.pendingFiles,...e.target.files].slice(0,10);renderUploadPreview();e.target.value=""};
  $("messageForm").onsubmit=async e=>{e.preventDefault();await sendText($("messageInput").value,state.pendingFiles)};
  $("messageInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("messageForm").requestSubmit()}};
  $("messageInput").oninput=e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,130)+"px"};
  $("activeSearchBtn").onclick=()=>{$("messageSearchBar").classList.toggle("hidden");if(!$("messageSearchBar").classList.contains("hidden"))$("messageSearchInput").focus()};
  $("closeMessageSearch").onclick=()=>{$("messageSearchBar").classList.add("hidden");$("messageSearchInput").value="";renderMessages()};
  $("messageSearchInput").oninput=renderMessages;
  $("backBtn").onclick=closeConversation;
  $("activeMenuBtn").onclick=e=>{const r=e.currentTarget.getBoundingClientRect();$("chatMenu").style.top=(r.bottom+6)+"px";$("chatMenu").style.right="18px";$("chatMenu").classList.toggle("hidden")};
  $("chatMenu").onclick=async e=>{const action=e.target.dataset.action;if(!action)return;$("chatMenu").classList.add("hidden");if(action==="archive")await archiveChat();if(action==="clear")await clearChat();if(action==="delete")await deleteChat();if(action==="block")await toggleBlock()};
  $("activeAvatar").ondblclick=saveContactName;
  document.addEventListener("click",e=>{if(!$("chatMenu").contains(e.target)&&e.target!==$("activeMenuBtn"))$("chatMenu").classList.add("hidden")});
}
init();
