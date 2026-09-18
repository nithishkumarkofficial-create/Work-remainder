(function(){
"use strict";

var Capacitor = window.Capacitor;
var Plugins = (Capacitor && Capacitor.Plugins) || {};
var LocalNotifications = Plugins.LocalNotifications;
var Preferences = Plugins.Preferences;
var CapApp = Plugins.App;
var Share = Plugins.Share;
var isNative = !!(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());

var tasks = [];
var history = [];
var settings = { eodOn: true, eodTime: "18:00", sound: true, vibrate: true, nag: false };
var filter = "all";
var reportRange = "today";
var editingId = null;

/* ---------------- storage ---------------- */
function $(id){ return document.getElementById(id); }

async function prefGet(key, fallback){
  try{
    var r = await Preferences.get({ key: key });
    if(!r || r.value == null) return fallback;
    return JSON.parse(r.value);
  }catch(e){ return fallback; }
}
async function prefSet(key, value){
  try{ await Preferences.set({ key: key, value: JSON.stringify(value) }); }catch(e){}
}
async function nextNotifId(){
  var n = await prefGet("notifCounter", 1000);
  n = n + 1;
  await prefSet("notifCounter", n);
  return n;
}
async function loadAll(){
  tasks = await prefGet("tasks", []);
  history = await prefGet("history", []);
  var s = await prefGet("settings", null);
  if(s) settings = Object.assign(settings, s);
}
async function saveTasks(){ await prefSet("tasks", tasks); }
async function saveHistory(){
  if(history.length > 1000) history = history.slice(history.length - 1000);
  await prefSet("history", history);
}
async function saveSettings(){ await prefSet("settings", settings); }
async function recordHistory(task, wasDone){
  history.push({
    taskId: task.id, title: task.title, prio: task.prio, notes: task.notes || "",
    createdAt: task.createdAt || null, date: task.date, time: task.time,
    repeat: task.repeat || null, done: !!wasDone, loggedAt: new Date().toISOString(),
  });
  await saveHistory();
}

/* ---------------- helpers ---------------- */
function p2(n){ return n<10 ? "0"+n : ""+n; }
function todayStr(){ var d=new Date(); return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate()); }
function hm(t){ var b=t.split(":"); return { h:+b[0], m:+b[1] }; }
function h12(t){ var b=t.split(":"), h=+b[0]; var ap=h>=12?"PM":"AM"; h=h%12||12; return h+":"+b[1]+" "+ap; }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function todayAt(h,m){ var d=new Date(); d.setHours(h,m,0,0); return d; }
function dur(ms){ var neg=ms<0; ms=Math.abs(ms);
  var m=Math.round(ms/60000), h=Math.floor(m/60); m=m%60;
  var s=h>0?(h+"h "+(m?m+"m":"")).trim():(m+"m"); return neg? s+" ago" : "in "+s; }
function uid(){ return "t"+Date.now()+Math.floor(Math.random()*999); }
function fmtShortDate(iso){
  try{
    var d = new Date(iso);
    return d.toLocaleDateString(undefined,{day:"numeric",month:"short"});
  }catch(e){ return ""; }
}
function fmtFullDateTime(iso){
  try{
    var d = new Date(iso);
    return d.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"}) +
      ", " + d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  }catch(e){ return ""; }
}
function dateOnly(iso){ return (iso||"").slice(0,10); }
function startOfWeek(d){
  var x = new Date(d); var day = x.getDay(); var diff = (day===0?-6:1) - day;
  x.setDate(x.getDate()+diff); x.setHours(0,0,0,0); return x;
}

/* ---------------- toasts ---------------- */
function toast(title, body, kind){
  var el = document.createElement("div");
  el.className = "toast" + (kind==="due" ? " due" : "");
  el.innerHTML = "<b>"+esc(title)+"</b><p>"+esc(body)+"</p>";
  $("toasts").appendChild(el);
  setTimeout(function(){ if(el.parentNode) el.remove(); }, 3200);
}

/* ---------------- notification scheduling ---------------- */
// Weekday enum per Capacitor: Sunday=1, Monday=2, ... Saturday=7
var WEEKDAYS_MF = [2,3,4,5,6];

async function cancelTaskNotifications(task){
  if(!LocalNotifications || !task.notifIds || !task.notifIds.length) return;
  try{
    await LocalNotifications.cancel({ notifications: task.notifIds.map(function(id){ return {id:id}; }) });
  }catch(e){}
  task.notifIds = [];
}

async function scheduleTask(task){
  if(!LocalNotifications) return;
  await cancelTaskNotifications(task);
  if(task.done) { await saveTasks(); return; }

  var t = hm(task.time);
  var remind = +task.remind || 30;
  var leadTotal = t.h*60 + t.m - remind;
  leadTotal = ((leadTotal % 1440) + 1440) % 1440;
  var leadH = Math.floor(leadTotal/60), leadM = leadTotal%60;

  var toSchedule = [];
  var ids = [];

  function pushOneTime(){
    var due = todayAt(t.h, t.m);
    var lead = new Date(due.getTime() - remind*60000);
    var now = new Date();
    if(due <= now){ due.setDate(due.getDate()+1); lead = new Date(due.getTime() - remind*60000); }
    return { due: due, lead: lead };
  }

  async function addNotif(title, body, schedule, extra){
    var id = await nextNotifId();
    ids.push(id);
    toSchedule.push({
      id: id, title: title, body: body,
      schedule: schedule,
      sound: settings.sound ? undefined : null,
      extra: extra || {}
    });
  }

  var leadBody = "Coming up in " + remind + " min - due at " + h12(task.time) + (task.notes ? "\n"+task.notes : "");
  var dueBody = "Due now (" + h12(task.time) + ")" + (task.notes ? "\n"+task.notes : "");

  if(!task.repeat){
    var times = pushOneTime();
    await addNotif(task.title, leadBody, { at: times.lead }, {taskId:task.id,kind:"lead"});
    await addNotif(task.title, dueBody, { at: times.due, allowWhileIdle:true }, {taskId:task.id,kind:"due"});
    if(settings.nag){
      for(var k=1;k<=6;k++){
        var nagAt = new Date(times.due.getTime() + k*10*60000);
        await addNotif("Still pending: " + task.title, "Was due at " + h12(task.time) + ".",
          { at: nagAt, allowWhileIdle:true }, {taskId:task.id,kind:"nag"});
      }
    }
  } else if(task.repeat === "1"){
    await addNotif(task.title, leadBody, { on:{hour:leadH,minute:leadM}, allowWhileIdle:true }, {taskId:task.id,kind:"lead"});
    await addNotif(task.title, dueBody, { on:{hour:t.h,minute:t.m}, allowWhileIdle:true }, {taskId:task.id,kind:"due"});
  } else if(task.repeat === "2"){
    for(var i=0;i<WEEKDAYS_MF.length;i++){
      var wd = WEEKDAYS_MF[i];
      await addNotif(task.title, leadBody,
        { on:{weekday:wd,hour:leadH,minute:leadM}, allowWhileIdle:true }, {taskId:task.id,kind:"lead"});
      await addNotif(task.title, dueBody,
        { on:{weekday:wd,hour:t.h,minute:t.m}, allowWhileIdle:true }, {taskId:task.id,kind:"due"});
    }
  }

  try{
    await LocalNotifications.schedule({ notifications: toSchedule });
    task.notifIds = ids;
  }catch(e){
    toast("Couldn't schedule", "Notification permission may be missing.", "due");
  }
  await saveTasks();
}

async function scheduleEod(){
  if(!LocalNotifications) return;
  var ids = await prefGet("eodNotifIds", []);
  if(ids.length){
    try{ await LocalNotifications.cancel({ notifications: ids.map(function(id){return {id:id};}) }); }catch(e){}
  }
  if(!settings.eodOn){ await prefSet("eodNotifIds", []); return; }
  var t = hm(settings.eodTime);
  var leadTotal = t.h*60 + t.m - 30;
  leadTotal = ((leadTotal % 1440) + 1440) % 1440;
  var leadH = Math.floor(leadTotal/60), leadM = leadTotal%60;
  var id1 = await nextNotifId(), id2 = await nextNotifId();
  var notifs = [
    { id:id1, title:"Work log due in 30 minutes",
      body:"Update what you worked on today before " + h12(settings.eodTime) + ".",
      schedule:{ on:{hour:leadH,minute:leadM}, allowWhileIdle:true } },
    { id:id2, title:"Time to update your work log",
      body:"It's " + h12(settings.eodTime) + " - log today's work now.",
      schedule:{ on:{hour:t.h,minute:t.m}, allowWhileIdle:true } },
  ];
  try{
    await LocalNotifications.schedule({ notifications: notifs });
    await prefSet("eodNotifIds", [id1,id2]);
  }catch(e){}
}

/* ---------------- CRUD ---------------- */
function find(id){ for(var i=0;i<tasks.length;i++) if(tasks[i].id===id) return tasks[i]; return null; }

function openSheet(task){
  editingId = task ? task.id : null;
  $("sheetTitle").textContent = task ? "Edit task" : "Add a task";
  $("sheetSave").textContent = task ? "Save changes" : "Add task";
  $("sheetDeleteRow").style.display = task ? "flex" : "none";
  $("fTitle").value = task ? task.title : "";
  $("fNotes").value = task ? (task.notes||"") : "";
  $("fTime").value = task ? task.time : "";
  $("fRemind").value = task ? String(task.remind) : "30";
  $("fPrio").value = task ? task.prio : "med";
  $("fRepeat").value = task ? (task.repeat||"0") : "0";
  if(task && task.createdAt){
    $("sheetCreated").style.display = "block";
    $("sheetCreated").textContent = "Created " + fmtFullDateTime(task.createdAt);
  } else {
    $("sheetCreated").style.display = "none";
  }
  $("sheetBg").classList.add("on");
  $("sheet").classList.add("on");
  setTimeout(function(){ $("fTitle").focus(); }, 200);
}
function closeSheet(){
  $("sheetBg").classList.remove("on");
  $("sheet").classList.remove("on");
  editingId = null;
}

async function saveFromSheet(){
  var title = $("fTitle").value.trim(), time = $("fTime").value;
  if(!title){ toast("Add a title","Tell me what the task is.","pre"); return; }
  if(!time){ toast("Pick a time","A reminder needs a due time.","pre"); return; }
  var rep = $("fRepeat").value === "0" ? null : $("fRepeat").value;
  var data = {
    title: title, notes: $("fNotes").value.trim(), time: time,
    remind: +$("fRemind").value, prio: $("fPrio").value, repeat: rep,
  };
  var task;
  if(editingId){
    task = find(editingId);
    if(!task) return;
    Object.assign(task, data);
    task.preFired = false; task.dueFired = false;
  } else {
    task = Object.assign({
      id: uid(), date: todayStr(), done: false, notifIds: [],
      createdAt: new Date().toISOString()
    }, data);
    tasks.push(task);
  }
  await saveTasks();
  await scheduleTask(task);
  closeSheet();
  render();
  toast(editingId ? "Task updated" : "Task added", title + " - " + h12(time), "pre");
}

async function toggleDone(id){
  var t = find(id); if(!t) return;
  t.done = !t.done;
  if(t.done){ await cancelTaskNotifications(t); await recordHistory(t, true); }
  else await scheduleTask(t);
  await saveTasks();
  render();
}
async function del(id){
  var t = find(id); if(!t) return;
  await cancelTaskNotifications(t);
  tasks = tasks.filter(function(x){ return x.id!==id; });
  await saveTasks();
  closeSheet();
  render();
}

/* ---------------- rollover (UI-only; OS handles actual firing) ---------------- */
function rolloverIfNeeded(){
  var td = todayStr(), dow = new Date().getDay(), changed=false;
  tasks.forEach(function(t){
    if(t.repeat && t.date !== td){
      if(t.repeat==="2" && (dow===0||dow===6)) return;
      recordHistory(t, !!t.done);
      t.date = td; t.done = false; changed = true;
    }
  });
  if(changed) saveTasks();
}

/* ---------------- render ---------------- */
function ts(date,time){ var a=date.split("-"),b=time.split(":");
  return new Date(+a[0],+a[1]-1,+a[2],+b[0],+b[1],0,0).getTime(); }

function render(){
  rolloverIfNeeded();
  var td = todayStr(), now = Date.now();
  var shown = tasks.filter(function(t){
    if(filter==="pending" && t.done) return false;
    if(filter==="done" && !t.done) return false;
    return true;
  }).sort(function(a,b){
    if(a.done!==b.done) return a.done?1:-1;
    return ts(a.date,a.time)-ts(b.date,b.time);
  });

  var list = $("list");
  if(!shown.length){
    list.innerHTML = '<div class="empty"><div>&#128221;</div>' +
      (tasks.length ? "Nothing matches this filter." : "No tasks yet &mdash; tap + to add one.") + '</div>';
  } else {
    list.innerHTML = shown.map(function(t){
      var late = !t.done && ts(t.date,t.time) < now;
      return '<li class="task p-'+t.prio+(t.done?" done":"")+'" data-open="'+t.id+'">' +
        '<button class="tick" data-tk="'+t.id+'">&#10003;</button>' +
        '<div class="t-body"><div class="t-title">'+esc(t.title)+'</div>' +
        (t.notes ? '<div class="t-notes">'+esc(t.notes)+'</div>' : '') +
        '<div class="t-meta"><span class="tag time">'+h12(t.time)+'</span>' +
        '<span class="tag cd" data-cd="'+t.id+'">&mdash;</span>' +
        '<span class="tag">&#128276; '+t.remind+'m</span>' +
        (t.repeat ? '<span class="tag">&#128260; '+(t.repeat==="1"?"daily":"weekdays")+'</span>' : '') +
        (t.createdAt ? '<span class="tag">Added '+fmtShortDate(t.createdAt)+'</span>' : '') +
        (late ? '<span class="tag" style="color:var(--dang)">overdue</span>' : '') +
        '</div></div></li>';
    }).join("");
  }

  var tdy = tasks.filter(function(t){ return t.date===td; });
  var done = tdy.filter(function(t){ return t.done; }).length;
  var late = tdy.filter(function(t){ return !t.done && ts(t.date,t.time)<now; }).length;
  $("sTotal").textContent = tdy.length; $("sDone").textContent = done;
  $("sPend").textContent = tdy.length-done; $("sLate").textContent = late;
  updateCountdowns(now);
}

function updateCountdowns(now){
  var td = todayStr();
  Array.prototype.forEach.call(document.querySelectorAll("[data-cd]"), function(el){
    var t = find(el.getAttribute("data-cd")); if(!t) return;
    var diff = ts(t.date,t.time) - now;
    if(t.done){ el.className="tag cd ok"; el.textContent="done"; return; }
    if(t.date !== td){ el.className="tag cd"; el.textContent=t.date; return; }
    el.textContent = dur(diff);
    el.className = "tag cd" + (diff<0 ? " late" : (diff<=(+t.remind)*60000 ? " soon" : ""));
  });
}

function tick(){
  var d = new Date();
  $("clock").textContent = p2(d.getHours())+":"+p2(d.getMinutes());
  $("dateline").textContent = d.toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"});
  var td = todayStr(), now=d.getTime(), next=null;
  tasks.forEach(function(t){
    if(t.done || t.date!==td) return;
    var due = ts(t.date,t.time);
    if(due>now && (!next || due<next.due)) next = {due:due, t:t};
  });
  $("nextline").textContent = next ? dur(next.due-now).replace("in ","") + " left" : "nothing scheduled";
  updateCountdowns(now);
}

/* ---------------- reports ---------------- */
function rangeStart(range){
  var now = new Date();
  if(range==="today") return new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(range==="week") return startOfWeek(now);
  if(range==="month") return new Date(now.getFullYear(),now.getMonth(),1);
  return null;
}
function buildEntries(range){
  var boundary = rangeStart(range);
  var map = {};
  history.forEach(function(h){
    if(boundary && new Date(h.date+"T00:00:00") < boundary) return;
    map[h.taskId+"|"+h.date] = {
      title:h.title, prio:h.prio, notes:h.notes||"", createdAt:h.createdAt,
      date:h.date, time:h.time, done:h.done, repeat:h.repeat
    };
  });
  tasks.forEach(function(t){
    if(boundary && new Date(t.date+"T00:00:00") < boundary) return;
    map[t.id+"|"+t.date] = {
      title:t.title, prio:t.prio, notes:t.notes||"", createdAt:t.createdAt,
      date:t.date, time:t.time, done:t.done, repeat:t.repeat
    };
  });
  var arr = Object.keys(map).map(function(k){ return map[k]; });
  arr.sort(function(a,b){ return (b.date+b.time).localeCompare(a.date+a.time); });
  return arr;
}
var RANGE_LABEL = {today:"Today's tasks", week:"This week's tasks", month:"This month's tasks", all:"All tasks"};
function renderReports(){
  var entries = buildEntries(reportRange);
  var total = entries.length, done = entries.filter(function(e){return e.done;}).length;
  var pending = total - done, rate = total ? Math.round(done/total*100) : 0;
  $("rTotal").textContent = total; $("rDone").textContent = done;
  $("rPend").textContent = pending; $("rRate").textContent = rate + "%";
  $("reportListTitle").textContent = RANGE_LABEL[reportRange] || "Tasks";
  var list = $("reportList");
  if(!entries.length){
    list.innerHTML = '<div class="empty"><div>&#128202;</div>No tasks in this range yet.</div>';
    return;
  }
  list.innerHTML = entries.map(function(e){
    return '<li class="task p-'+e.prio+(e.done?" done":"")+'">' +
      '<span class="tick" style="border-color:transparent">'+(e.done?"&#9989;":"&#8231;")+'</span>' +
      '<div class="t-body"><div class="t-title">'+esc(e.title)+'</div>' +
      (e.notes ? '<div class="t-notes">'+esc(e.notes)+'</div>' : '') +
      '<div class="t-meta"><span class="tag">'+e.date+'</span><span class="tag time">'+h12(e.time)+'</span>' +
      (e.createdAt ? '<span class="tag">Created '+fmtShortDate(e.createdAt)+'</span>' : '') +
      (e.repeat ? '<span class="tag">&#128260; '+(e.repeat==="1"?"daily":"weekdays")+'</span>' : '') +
      '</div></div></li>';
  }).join("");
}
function buildReportText(range){
  var entries = buildEntries(range);
  var total = entries.length, done = entries.filter(function(e){return e.done;}).length;
  var lines = [];
  lines.push("Work Reminder - " + (RANGE_LABEL[range]||"Tasks") + " report");
  lines.push("Generated " + new Date().toLocaleString());
  lines.push("");
  lines.push("Completed: " + done + " / " + total);
  lines.push("");
  var byDate = {};
  entries.forEach(function(e){ (byDate[e.date] = byDate[e.date]||[]).push(e); });
  Object.keys(byDate).sort().reverse().forEach(function(d){
    lines.push("== " + d + " ==");
    byDate[d].forEach(function(e){
      lines.push((e.done?"[x] ":"[ ] ") + e.title + " - " + h12(e.time) + (e.notes ? (" - "+e.notes) : ""));
    });
    lines.push("");
  });
  return lines.join("\n");
}
async function shareReport(){
  var text = buildReportText(reportRange);
  if(Share && isNative){
    try{ await Share.share({ title: "Work Reminder report", text: text }); return; }
    catch(e){ return; }
  }
  if(navigator.share){
    try{ await navigator.share({ title:"Work Reminder report", text:text }); return; }catch(e){}
  }
  try{
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard","Paste it anywhere to share.","pre");
  }catch(e){
    toast("Couldn't share","Sharing isn't available here.","due");
  }
}

/* ---------------- settings UI ---------------- */
function syncSettingsUI(){
  $("eodTime").value = settings.eodTime;
  $("eodOn").classList.toggle("on", !!settings.eodOn);
  $("swSound").classList.toggle("on", !!settings.sound);
  $("swVibrate").classList.toggle("on", !!settings.vibrate);
  $("swNag").classList.toggle("on", !!settings.nag);
}
function wireToggle(id, key, after){
  $(id).addEventListener("click", async function(){
    settings[key] = !settings[key];
    $(id).classList.toggle("on", settings[key]);
    await saveSettings();
    if(after) await after();
  });
}

/* ---------------- permissions ---------------- */
async function checkPerms(){
  if(!LocalNotifications){ return; }
  try{
    var res = await LocalNotifications.checkPermissions();
    var granted = res && res.display === "granted";
    $("permBanner").style.display = granted ? "none" : "flex";
    return granted;
  }catch(e){ return false; }
}
async function requestPerms(){
  if(!LocalNotifications) return;
  try{
    await LocalNotifications.requestPermissions();
    try{
      var chk = await LocalNotifications.checkExactNotificationSetting();
      if(chk && chk.exact_alarm && chk.exact_alarm!=="granted"){
        await LocalNotifications.changeExactNotificationSetting();
      }
    }catch(e){}
  }catch(e){}
  await checkPerms();
}

/* ---------------- events ---------------- */
$("fab").addEventListener("click", function(){ openSheet(null); });
$("sheetBg").addEventListener("click", closeSheet);
$("sheetCancel").addEventListener("click", closeSheet);
$("sheetSave").addEventListener("click", saveFromSheet);
$("sheetDelete").addEventListener("click", function(){ if(editingId) del(editingId); });
$("permBtn").addEventListener("click", requestPerms);
$("testBtn").addEventListener("click", async function(){
  if(!LocalNotifications){ toast("Preview mode","Notifications only work in the built app.","pre"); return; }
  var id = await nextNotifId();
  try{
    await LocalNotifications.schedule({ notifications: [{
      id:id, title:"Test reminder", body:"This is what a reminder looks like.",
      schedule:{ at: new Date(Date.now()+3000) }
    }]});
    toast("Test scheduled","Arriving in a few seconds.","pre");
  }catch(e){ toast("Couldn't schedule","Check notification permission.","due"); }
});
$("clrBtn").addEventListener("click", async function(){
  var keep = [];
  for(var i=0;i<tasks.length;i++){
    var t = tasks[i];
    if(t.done && !t.repeat) await cancelTaskNotifications(t);
    else keep.push(t);
  }
  tasks = keep; await saveTasks(); render();
});
$("eodTime").addEventListener("change", async function(e){
  settings.eodTime = e.target.value || "18:00"; await saveSettings(); await scheduleEod();
});
wireToggle("eodOn","eodOn", scheduleEod);
wireToggle("swSound","sound");
wireToggle("swVibrate","vibrate");
wireToggle("swNag","nag");

Array.prototype.forEach.call(document.querySelectorAll(".chip[data-f]"), function(ch){
  ch.addEventListener("click", function(){
    Array.prototype.forEach.call(document.querySelectorAll(".chip[data-f]"), function(x){ x.classList.remove("on"); });
    ch.classList.add("on"); filter = ch.getAttribute("data-f"); render();
  });
});
Array.prototype.forEach.call(document.querySelectorAll(".chip[data-r]"), function(ch){
  ch.addEventListener("click", function(){
    Array.prototype.forEach.call(document.querySelectorAll(".chip[data-r]"), function(x){ x.classList.remove("on"); });
    ch.classList.add("on"); reportRange = ch.getAttribute("data-r"); renderReports();
  });
});
$("shareReportBtn").addEventListener("click", shareReport);
Array.prototype.forEach.call(document.querySelectorAll(".navbtn"), function(nb){
  nb.addEventListener("click", function(){
    Array.prototype.forEach.call(document.querySelectorAll(".navbtn"), function(x){ x.classList.remove("on"); });
    Array.prototype.forEach.call(document.querySelectorAll(".page"), function(x){ x.classList.remove("on"); });
    nb.classList.add("on");
    var page = nb.getAttribute("data-page");
    $(page).classList.add("on");
    if(page === "pageReports") renderReports();
  });
});
$("list").addEventListener("click", function(e){
  var tk = e.target.getAttribute("data-tk");
  if(tk){ toggleDone(tk); return; }
  var li = e.target.closest ? e.target.closest("[data-open]") : null;
  if(li){ var t = find(li.getAttribute("data-open")); if(t) openSheet(t); }
});

/* ---------------- boot ---------------- */
async function boot(){
  await loadAll();
  syncSettingsUI();
  render();
  tick();
  setInterval(tick, 1000);
  var granted = await checkPerms();
  if(!granted && LocalNotifications){
    // ask once automatically on first run for a smoother experience
    await requestPerms();
  }
  if(CapApp && CapApp.addListener){
    CapApp.addListener("resume", function(){ render(); tick(); });
  }
}
if(document.readyState === "complete" || document.readyState === "interactive") boot();
else document.addEventListener("DOMContentLoaded", boot);

})();
