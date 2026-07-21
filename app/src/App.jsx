import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Plus, Trash2, X, ChevronLeft, ChevronRight, Clock, CheckCircle2, Circle, Loader2, CalendarDays, LayoutList, GripVertical, Eye, EyeOff, Repeat, AlertTriangle, Users, LogOut, Menu, Settings, KeyRound } from 'lucide-react';
import { api, saveToken, clearToken, hasToken } from './api';

const THEME = {
  paper: '#FBFAF6',
  paperDeep: '#F1EDE3',
  ink: '#23282E',
  inkSoft: '#6B7280',
  rule: '#DAD4C4',
  pine: '#2F6F5E',
  pineDeep: '#20493D',
  rust: '#A8452F',
  ochre: '#B9852E',
  slate: '#4C7A8C',
};

const PRIORITY_META = {
  high: { color: THEME.rust, label: 'High' },
  medium: { color: THEME.ochre, label: 'Medium' },
  low: { color: THEME.slate, label: 'Low' },
};

const REPEAT_META = {
  none: 'No repeat',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
};

const DURATIONS = [15, 30, 45, 60, 90, 120];
const DAY_START = 7 * 60;
const DAY_END = 21 * 60;
const PIXELS_PER_HOUR = 64;
const SNAP = 15; // minutes

function pad(n) { return n.toString().padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtDay(d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
function startOfWeek(d) { const x = new Date(d); const day = x.getDay(); const diff = day === 0 ? -6 : 1 - day; x.setDate(x.getDate() + diff); x.setHours(0, 0, 0, 0); return x; }
function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minutesToTime(m) { const h = Math.floor(m / 60); const mm = m % 60; return `${pad(h)}:${pad(mm)}`; }
function addMinutes(t, mins) { return minutesToTime(timeToMinutes(t) + mins); }
function fmt12(t) { const [h, m] = t.split(':').map(Number); const period = h >= 12 ? 'PM' : 'AM'; let hh = h % 12; if (hh === 0) hh = 12; return m === 0 ? `${hh} ${period}` : `${hh}:${pad(m)} ${period}`; }
function formatDuration(mins) {
  if (mins < 60) return `${mins}m`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function snap(mins) { return Math.round(mins / SNAP) * SNAP; }
function occurrenceDates(startDate, repeat) {
  const dates = [];
  const d = new Date(startDate);
  if (repeat === 'daily') {
    for (let i = 0; i < 14; i++) { dates.push(dateKey(d)); d.setDate(d.getDate() + 1); }
  } else if (repeat === 'weekdays') {
    let count = 0, guard = 0;
    while (count < 14 && guard < 60) { const day = d.getDay(); if (day !== 0 && day !== 6) { dates.push(dateKey(d)); count++; } d.setDate(d.getDate() + 1); guard++; }
  } else if (repeat === 'weekly') {
    for (let i = 0; i < 8; i++) { dates.push(dateKey(d)); d.setDate(d.getDate() + 7); }
  } else {
    dates.push(dateKey(startDate));
  }
  return dates;
}
function overlaps(list, excludeId, start, duration) {
  const s1 = timeToMinutes(start), e1 = s1 + duration;
  return list.find(t => t.id !== excludeId && t.start && (() => {
    const s2 = timeToMinutes(t.start), e2 = s2 + t.duration;
    return s1 < e2 && s2 < e1;
  })());
}

let idCounter = 1;
function genId() { return `t${Date.now()}${idCounter++}`; }

function Planner({ user, onLogout }) {
  const [tasks, setTasks] = useState([]);
  const [scope, setScope] = useState('personal'); // 'personal' | 'team'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('day');
  const [newTitle, setNewTitle] = useState('');
  const [newDuration, setNewDuration] = useState(30);
  const [newPriority, setNewPriority] = useState('medium');
  const [newRepeat, setNewRepeat] = useState('none');
  const [newStartTime, setNewStartTime] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [focusNote, setFocusNote] = useState({});
  const [editingTime, setEditingTime] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [now, setNow] = useState(new Date());
  const [pendingConflict, setPendingConflict] = useState(null); // { id, start, conflictTitle }
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    api.tasks().then(d => setTasks(d.tasks || [])).catch(() => setSaveError(true));
  }, []);

  function withRollback(mutate, rollbackTasks, apiCall) {
    mutate();
    apiCall().then(() => setSaveError(false)).catch(() => { setTasks(rollbackTasks); setSaveError(true); });
  }

  const key = dateKey(currentDate);
  const scopedTasks = tasks.filter(t => t.scope === scope);
  const dayTasksAll = scopedTasks.filter(t => t.date === key);
  const dayTasks = hideCompleted ? dayTasksAll.filter(t => !t.done) : dayTasksAll;
  const inboxTasks = dayTasks.filter(t => !t.start);
  const scheduledTasks = dayTasks.filter(t => t.start).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  const doneCount = dayTasksAll.filter(t => t.done).length;

  function addTask() {
    if (!newTitle.trim()) return;
    const recurrenceId = newRepeat !== 'none' ? genId() : null;
    const dates = occurrenceDates(currentDate, newRepeat);
    const start = newStartTime || null;
    const newTasks = dates.map(d => ({
      id: genId(), title: newTitle.trim(), duration: newDuration, priority: newPriority,
      date: d, start, done: false, aiGenerated: false, recurrenceId, scope
    }));
    const prev = tasks;
    setTasks(t => [...t, ...newTasks]);
    Promise.all(newTasks.map(t => api.createTask(t))).then(() => setSaveError(false)).catch(() => { setTasks(prev); setSaveError(true); });
    if (start) {
      const todays = newTasks.find(t => t.date === key);
      if (todays) {
        const conflict = overlaps(scheduledTasks, null, start, newDuration);
        if (conflict) setPendingConflict({ id: todays.id, start, conflictTitle: conflict.title });
      }
    }
    setNewTitle('');
    setNewRepeat('none');
    setNewStartTime('');
  }

  function deleteTask(id) {
    const prev = tasks;
    withRollback(() => setTasks(t => t.filter(x => x.id !== id)), prev, () => api.deleteTask(id));
  }
  function deleteSeries(recurrenceId, fromDate) {
    const prev = tasks;
    withRollback(() => setTasks(t => t.filter(x => !(x.recurrenceId === recurrenceId && x.date >= fromDate))), prev, () => api.deleteSeries(recurrenceId, fromDate));
  }
  function toggleDone(id) {
    const prev = tasks;
    const current = tasks.find(t => t.id === id);
    if (!current) return;
    const done = !current.done;
    withRollback(() => setTasks(t => t.map(x => x.id === id ? { ...x, done } : x)), prev, () => api.updateTask(id, { done }));
  }
  function setTaskTime(id, start) {
    const prev = tasks;
    withRollback(() => setTasks(t => t.map(x => x.id === id ? { ...x, start, aiGenerated: false } : x)), prev, () => api.updateTask(id, { start, aiGenerated: false }));
    setEditingTime(null);
  }
  function unschedule(id) {
    const prev = tasks;
    withRollback(() => setTasks(t => t.map(x => x.id === id ? { ...x, start: null, aiGenerated: false } : x)), prev, () => api.updateTask(id, { start: null, aiGenerated: false }));
  }
  function renameTask(id, title) {
    const clean = title.trim();
    if (!clean) return;
    const prev = tasks;
    withRollback(() => setTasks(t => t.map(x => x.id === id ? { ...x, title: clean } : x)), prev, () => api.updateTask(id, { title: clean }));
  }
  function editTaskFields(id, patch) {
    const prev = tasks;
    withRollback(() => setTasks(t => t.map(x => x.id === id ? { ...x, ...patch } : x)), prev, () => api.updateTask(id, patch));
  }

  function attemptReschedule(id, start) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const conflict = overlaps(scheduledTasks, id, start, task.duration);
    if (conflict) {
      setPendingConflict({ id, start, conflictTitle: conflict.title });
    } else {
      setTaskTime(id, start);
    }
  }

  async function callClaude(prompt) {
    try {
      const data = await api.plan(prompt);
      const textBlock = (data.content || []).find(b => b.type === 'text');
      if (!textBlock) throw new Error('empty response');
      const clean = textBlock.text.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw new Error('unauthorized');
      throw e;
    }
  }

  async function planWithAI() {
    if (inboxTasks.length === 0) { setAiError('Add a task to the inbox before planning.'); return; }
    setAiLoading(true);
    setAiError('');
    try {
      const fixed = scheduledTasks.map(t => ({ title: t.title, start: t.start, end: addMinutes(t.start, t.duration) }));
      const toSchedule = inboxTasks.map(t => ({ id: t.id, title: t.title, duration: t.duration, priority: t.priority }));
      const prompt = `You are a scheduling assistant for a daily planner. Working hours are 08:00 to 20:00.
Fixed commitments already on the schedule, do not overlap these: ${JSON.stringify(fixed)}
Tasks needing time blocks (id, title, duration in minutes, priority): ${JSON.stringify(toSchedule)}
Order by priority (high first), pack sensibly, leave short breaks where it helps focus.
Respond with ONLY raw JSON, no markdown fences, no commentary, in exactly this shape:
{"focus": "one short encouraging sentence about the shape of the day, under 16 words", "blocks": [{"id": "task id", "start": "HH:MM"}]}
Every task id must appear exactly once in blocks. Times must be 24h HH:MM and must not overlap fixed commitments or each other.`;
      const parsed = await callClaude(prompt);
      const blockMap = {};
      (parsed.blocks || []).forEach(b => { blockMap[b.id] = b.start; });
      setTasks(prev => prev.map(t => blockMap[t.id] ? { ...t, start: blockMap[t.id], aiGenerated: true } : t));
      setFocusNote(prev => ({ ...prev, [key]: parsed.focus || '' }));
    } catch (e) {
      if (e.message === 'unauthorized') { setAiError('Your session expired — signing you out.'); onLogout(); }
      else setAiError('Could not reach the planning assistant. Try again in a moment.');
    } finally {
      setAiLoading(false);
    }
  }

  async function rebalanceDay(movedId, preferredStart) {
    setPendingConflict(null);
    setAiLoading(true);
    setAiError('');
    try {
      const list = scheduledTasks.map(t => ({
        id: t.id, title: t.title, duration: t.duration, priority: t.priority,
        preferredStart: t.id === movedId ? preferredStart : undefined
      }));
      const prompt = `You are a scheduling assistant reflowing one day's schedule so nothing overlaps. Working hours are 08:00 to 20:00.
Tasks (id, title, duration in minutes, priority, and an optional preferredStart hint to honor if at all possible): ${JSON.stringify(list)}
Keep each task close to its preferredStart when given, otherwise keep the day's overall order sensible, and give high priority tasks good slots. No two tasks may overlap.
Respond with ONLY raw JSON, no markdown fences, no commentary, in exactly this shape:
{"focus": "one short encouraging sentence about the shape of the day, under 16 words", "blocks": [{"id": "task id", "start": "HH:MM"}]}
Every task id must appear exactly once in blocks.`;
      const parsed = await callClaude(prompt);
      const blockMap = {};
      (parsed.blocks || []).forEach(b => { blockMap[b.id] = b.start; });
      setTasks(prev => prev.map(t => blockMap[t.id] ? { ...t, start: blockMap[t.id], aiGenerated: true } : t));
      setFocusNote(prev => ({ ...prev, [key]: parsed.focus || '' }));
    } catch (e) {
      if (e.message === 'unauthorized') { setAiError('Your session expired — signing you out.'); onLogout(); }
      else setAiError('Could not reach the planning assistant. Try again in a moment.');
    } finally {
      setAiLoading(false);
    }
  }

  function shiftDay(delta) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + delta);
    setCurrentDate(d);
  }

  const hours = [];
  for (let m = DAY_START; m < DAY_END; m += 60) hours.push(m);

  const weekDays = [];
  const ws = startOfWeek(currentDate);
  for (let i = 0; i < 7; i++) { const d = new Date(ws); d.setDate(ws.getDate() + i); weekDays.push(d); }

  const isToday = key === dateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div style={{ minHeight: '100vh', background: THEME.paper, color: THEME.ink, fontFamily: "'Inter', sans-serif", display: 'flex' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input, select, button { font-family: inherit; }
        input:focus, button:focus { outline: 2px solid ${THEME.pine}; outline-offset: 1px; }
        .btn-primary { transition: background 0.15s ease, transform 0.1s ease; }
        .btn-primary:hover { background: ${THEME.pineDeep} !important; }
        .btn-primary:active { transform: scale(0.98); }
        .icon-btn { transition: background 0.15s ease, color 0.15s ease; }
        .icon-btn:hover { background: ${THEME.paperDeep}; }
        .task-card { transition: box-shadow 0.15s ease, border-color 0.15s ease; }
        .task-card:hover { border-color: ${THEME.ink} !important; box-shadow: 2px 2px 0 ${THEME.rule}; }
        .task-card .del-btn { opacity: 0; transition: opacity 0.15s ease; }
        .task-card:hover .del-btn { opacity: 1; }
        .nav-pill { transition: background 0.15s ease, color 0.15s ease; }
        .day-cell { transition: background 0.15s ease, border-color 0.15s ease; cursor: pointer; }
        .day-cell:hover { border-color: ${THEME.pine} !important; }
        .pill-btn { transition: all 0.12s ease; cursor: pointer; }
        .block-card { transition: box-shadow 0.12s ease; }
        .block-card:hover { box-shadow: 2px 2px 0 rgba(0,0,0,0.06); }
        .drag-handle { cursor: grab; touch-action: none; color: ${THEME.inkSoft}; }
        .drag-handle:active { cursor: grabbing; }
        .editable-title:hover { text-decoration: underline dotted; text-underline-offset: 3px; cursor: text; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        ::placeholder { color: ${THEME.inkSoft}; opacity: 0.7; }
        .mobile-nav { display: none; }
        @media (max-width: 760px) {
          .sidebar { display: none !important; }
          .mobile-nav { display: flex !important; }
          .main-cols { flex-direction: column !important; }
          .schedule-col, .inbox-col { width: 100% !important; }
          main { padding: 16px 14px !important; }
          .pill-btn { padding: 6px 11px !important; font-size: 12.5px !important; }
          .icon-btn { padding: 9px !important; }
          h1 { font-size: 19px !important; min-width: 0 !important; }
        }
      `}</style>

      <aside className="sidebar" style={{ width: 208, flexShrink: 0, borderRight: `1px solid ${THEME.rule}`, padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 600, fontSize: 25, letterSpacing: '-0.01em' }}>PlanForge</div>
          <div style={{ fontSize: 12, color: THEME.inkSoft, marginTop: 2 }}>{user.name}</div>
        </div>

        <div style={{ display: 'flex', gap: 4, background: THEME.paperDeep, borderRadius: 8, padding: 3, marginBottom: 18 }}>
          <button onClick={() => setScope('personal')} style={{
            flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            background: scope === 'personal' ? '#fff' : 'transparent', color: THEME.ink, boxShadow: scope === 'personal' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'
          }}>My Day</button>
          <button onClick={() => setScope('team')} style={{
            flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            background: scope === 'team' ? '#fff' : 'transparent', color: THEME.ink, boxShadow: scope === 'team' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'
          }}>Team</button>
        </div>

        <button onClick={() => setView('day')} className="nav-pill" style={{
          display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none',
          background: view === 'day' ? THEME.pine : 'transparent', color: view === 'day' ? THEME.paper : THEME.ink, fontSize: 14, fontWeight: 500, cursor: 'pointer'
        }}><LayoutList size={16} /> Today</button>
        <button onClick={() => setView('week')} className="nav-pill" style={{
          display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none',
          background: view === 'week' ? THEME.pine : 'transparent', color: view === 'week' ? THEME.paper : THEME.ink, fontSize: 14, fontWeight: 500, cursor: 'pointer'
        }}><CalendarDays size={16} /> Week</button>
        {user.role === 'owner' && (
          <button onClick={() => setView('team')} className="nav-pill" style={{
            display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none',
            background: view === 'team' ? THEME.pine : 'transparent', color: view === 'team' ? THEME.paper : THEME.ink, fontSize: 14, fontWeight: 500, cursor: 'pointer'
          }}><Users size={16} /> Manage team</button>
        )}
        {user.role === 'owner' && (
          <button onClick={() => setView('org')} className="nav-pill" style={{
            display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none',
            background: view === 'org' ? THEME.pine : 'transparent', color: view === 'org' ? THEME.paper : THEME.ink, fontSize: 14, fontWeight: 500, cursor: 'pointer'
          }}><Settings size={16} /> Org settings</button>
        )}

        {doneCount > 0 && (
          <button onClick={() => setHideCompleted(v => !v)} className="nav-pill" style={{
            display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none',
            background: 'transparent', color: THEME.inkSoft, fontSize: 13, fontWeight: 500, cursor: 'pointer', marginTop: 10
          }}>{hideCompleted ? <Eye size={15} /> : <EyeOff size={15} />} {hideCompleted ? 'Show' : 'Hide'} completed ({doneCount})</button>
        )}

        <button onClick={() => setShowPasswordModal(true)} className="nav-pill" style={{
          display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none',
          background: 'transparent', color: THEME.inkSoft, fontSize: 13, fontWeight: 500, cursor: 'pointer'
        }}>Change password</button>
        <button onClick={onLogout} className="nav-pill" style={{
          display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none',
          background: 'transparent', color: THEME.inkSoft, fontSize: 13, fontWeight: 500, cursor: 'pointer', marginTop: 'auto'
        }}><LogOut size={15} /> Sign out</button>

        <div style={{ fontSize: 11, color: THEME.inkSoft, lineHeight: 1.5 }}>
          {saveError ? "Changes aren't syncing right now." : ' '}
        </div>
      </aside>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}

      <main style={{ flex: 1, padding: '28px 32px', maxWidth: 1100 }}>
        <div className="mobile-nav" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 10 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 600, fontSize: 19 }}>PlanForge</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setView('day')} style={{
              padding: '7px 12px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: view === 'day' ? THEME.pine : THEME.paperDeep, color: view === 'day' ? '#fff' : THEME.ink
            }}>Today</button>
            <button onClick={() => setView('week')} style={{
              padding: '7px 12px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: view === 'week' ? THEME.pine : THEME.paperDeep, color: view === 'week' ? '#fff' : THEME.ink
            }}>Week</button>
            <button onClick={() => setMobileMenuOpen(v => !v)} className="icon-btn" style={{ ...iconBtnStyle, border: `1px solid ${THEME.rule}` }}>
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="mobile-nav" style={{
            flexDirection: 'column', gap: 4, border: `1px solid ${THEME.rule}`, borderRadius: 10, padding: 12, marginBottom: 18, background: '#fff'
          }}>
            <div style={{ display: 'flex', gap: 4, background: THEME.paperDeep, borderRadius: 8, padding: 3, marginBottom: 8 }}>
              <button onClick={() => setScope('personal')} style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: scope === 'personal' ? '#fff' : 'transparent', color: THEME.ink
              }}>My Day</button>
              <button onClick={() => setScope('team')} style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: scope === 'team' ? '#fff' : 'transparent', color: THEME.ink
              }}>Team</button>
            </div>
            {user.role === 'owner' && (
              <MobileMenuItem icon={<Users size={16} />} label="Manage team" onClick={() => { setView('team'); setMobileMenuOpen(false); }} />
            )}
            {user.role === 'owner' && (
              <MobileMenuItem icon={<Settings size={16} />} label="Org settings" onClick={() => { setView('org'); setMobileMenuOpen(false); }} />
            )}
            <MobileMenuItem icon={<KeyRound size={16} />} label="Change password" onClick={() => { setShowPasswordModal(true); setMobileMenuOpen(false); }} />
            {doneCount > 0 && (
              <MobileMenuItem icon={hideCompleted ? <Eye size={16} /> : <EyeOff size={16} />} label={`${hideCompleted ? 'Show' : 'Hide'} completed (${doneCount})`} onClick={() => { setHideCompleted(v => !v); setMobileMenuOpen(false); }} />
            )}
            <MobileMenuItem icon={<LogOut size={16} />} label="Sign out" onClick={onLogout} />
          </div>
        )}
        {view === 'day' ? (
          <DayView
            currentDate={currentDate}
            shiftDay={shiftDay}
            inboxTasks={inboxTasks}
            scheduledTasks={scheduledTasks}
            hours={hours}
            newTitle={newTitle} setNewTitle={setNewTitle}
            newDuration={newDuration} setNewDuration={setNewDuration}
            newPriority={newPriority} setNewPriority={setNewPriority}
            newRepeat={newRepeat} setNewRepeat={setNewRepeat}
            newStartTime={newStartTime} setNewStartTime={setNewStartTime}
            scope={scope}
            addTask={addTask} deleteTask={deleteTask} deleteSeries={deleteSeries} toggleDone={toggleDone} renameTask={renameTask} editTaskFields={editTaskFields}
            editingTime={editingTime} setEditingTime={setEditingTime} setTaskTime={setTaskTime} unschedule={unschedule}
            aiLoading={aiLoading} aiError={aiError} planWithAI={planWithAI}
            focus={focusNote[key]}
            isToday={isToday} nowMinutes={nowMinutes}
            attemptReschedule={attemptReschedule}
            pendingConflict={pendingConflict} setPendingConflict={setPendingConflict}
            onPlaceAnyway={() => { if (pendingConflict) { setTaskTime(pendingConflict.id, pendingConflict.start); setPendingConflict(null); } }}
            onRebalance={() => { if (pendingConflict) rebalanceDay(pendingConflict.id, pendingConflict.start); }}
          />
        ) : view === 'week' ? (
          <WeekView weekDays={weekDays} tasks={scopedTasks} onPick={(d) => { setCurrentDate(d); setView('day'); }} />
        ) : view === 'org' ? (
          <OrgSettingsView />
        ) : (
          <TeamView />
        )}
      </main>
    </div>
  );
}

function DayView({ currentDate, shiftDay, inboxTasks, scheduledTasks, hours, newTitle, setNewTitle, newDuration, setNewDuration, newPriority, setNewPriority, newRepeat, setNewRepeat, newStartTime, setNewStartTime, scope, addTask, deleteTask, deleteSeries, toggleDone, renameTask, editTaskFields, editingTime, setEditingTime, setTaskTime, unschedule, aiLoading, aiError, planWithAI, focus, isToday, nowMinutes, attemptReschedule, pendingConflict, setPendingConflict, onPlaceAnyway, onRebalance }) {
  const [drag, setDrag] = useState(null); // { id, top, duration, startY, startTop }
  const scheduleHeight = hours.length * PIXELS_PER_HOUR;
  const nowLineRef = useRef(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (isToday && !scrolledRef.current && nowLineRef.current) {
      nowLineRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
      scrolledRef.current = true;
    }
  }, [isToday]);

  function topForStart(start) {
    return Math.max(0, (timeToMinutes(start) - DAY_START) / 60 * PIXELS_PER_HOUR);
  }

  function handlePointerDown(e, task) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startTop = topForStart(task.start);
    setDrag({ id: task.id, top: startTop, duration: task.duration, startY: e.clientY, startTop });
  }
  function handlePointerMove(e) {
    if (!drag) return;
    const delta = e.clientY - drag.startY;
    const maxTop = scheduleHeight - 24;
    let newTop = Math.min(Math.max(0, drag.startTop + delta), maxTop);
    newTop = Math.round(newTop / 16) * 16;
    setDrag(d => d ? { ...d, top: newTop } : d);
  }
  function handlePointerUp() {
    if (!drag) return;
    const rawMinutes = DAY_START + (drag.top / PIXELS_PER_HOUR) * 60;
    const clamped = Math.min(Math.max(DAY_START, rawMinutes), DAY_END - drag.duration);
    attemptReschedule(drag.id, minutesToTime(snap(clamped)));
    setDrag(null);
  }

  const nowTop = topForStart(minutesToTime(nowMinutes));
  const showNowLine = isToday && nowMinutes >= DAY_START && nowMinutes <= DAY_END;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="icon-btn" onClick={() => shiftDay(-1)} style={iconBtnStyle}><ChevronLeft size={18} /></button>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 22, margin: 0, minWidth: 220 }}>{fmtDay(currentDate)}</h1>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: THEME.inkSoft,
            border: `1px solid ${THEME.rule}`, borderRadius: 5, padding: '2px 7px'
          }}>{scope === 'team' ? 'Team' : 'My Day'}</span>
          <button className="icon-btn" onClick={() => shiftDay(1)} style={iconBtnStyle}><ChevronRight size={18} /></button>
        </div>
        <button onClick={planWithAI} disabled={aiLoading} className="btn-primary" style={{
          display: 'flex', alignItems: 'center', gap: 8, background: THEME.pine, color: THEME.paper, border: 'none',
          borderRadius: 9, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: aiLoading ? 'default' : 'pointer', opacity: aiLoading ? 0.75 : 1
        }}>
          {aiLoading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
          {aiLoading ? 'Planning…' : 'Plan my day'}
        </button>
      </div>

      {aiError && <div style={{ fontSize: 13, color: THEME.rust, marginBottom: 10 }}>{aiError}</div>}
      {focus && !aiError && (
        <div style={{
          fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: 14.5, color: THEME.pineDeep,
          background: '#EAF1EC', border: `1px solid #CFE0D5`, borderRadius: 8, padding: '9px 14px', marginBottom: 18, display: 'inline-block'
        }}>✦ {focus}</div>
      )}

      {pendingConflict && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#FBEEE9', border: `1px solid #E3B7A4`,
          borderRadius: 8, padding: '10px 14px', marginBottom: 16
        }}>
          <AlertTriangle size={16} color={THEME.rust} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: THEME.ink, flex: 1, minWidth: 200 }}>That time overlaps <strong>{pendingConflict.conflictTitle}</strong>.</span>
          <button onClick={onRebalance} disabled={aiLoading} style={{ ...smallBtn, background: THEME.pine, color: '#fff', border: 'none' }}>
            {aiLoading ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />} Let AI rebalance
          </button>
          <button onClick={onPlaceAnyway} style={{ ...smallBtn, background: '#fff', border: `1px solid ${THEME.rule}`, color: THEME.ink }}>Place anyway</button>
          <button onClick={() => setPendingConflict(null)} style={{ ...smallBtn, background: 'none', border: 'none', color: THEME.inkSoft }}>Cancel</button>
        </div>
      )}

      <div className="main-cols" style={{ display: 'flex', gap: 24, marginTop: focus ? 4 : 18 }}>
        <div className="inbox-col" style={{ width: 300, flexShrink: 0 }}>
          <SectionLabel>Inbox</SectionLabel>
          <div style={{ border: `1px solid ${THEME.rule}`, borderRadius: 10, padding: 12, marginBottom: 14, background: '#fff' }}>
            <input
              value={newTitle} onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }}
              placeholder="Add a task…"
              style={{ width: '100%', border: `1px solid ${THEME.rule}`, borderRadius: 6, padding: '7px 9px', fontSize: 14, marginBottom: 10, fontWeight: 500 }}
            />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
              {DURATIONS.map(d => (
                <button type="button" key={d} onClick={() => setNewDuration(d)} className="pill-btn" style={pillStyle(newDuration === d)}>{formatDuration(d)}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
              {Object.entries(PRIORITY_META).map(([k, v]) => (
                <button type="button" key={k} onClick={() => setNewPriority(k)} className="pill-btn" style={{
                  ...pillStyle(newPriority === k), borderColor: newPriority === k ? v.color : THEME.rule,
                  color: newPriority === k ? v.color : THEME.inkSoft, background: newPriority === k ? `${v.color}14` : '#fff'
                }}>{v.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
              {Object.entries(REPEAT_META).map(([k, label]) => (
                <button type="button" key={k} onClick={() => setNewRepeat(k)} className="pill-btn" style={{
                  ...pillStyle(newRepeat === k), display: 'flex', alignItems: 'center', gap: 4
                }}>{k !== 'none' && <Repeat size={10} />}{label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <Clock size={13} color={THEME.inkSoft} style={{ flexShrink: 0 }} />
              <input type="time" value={newStartTime} onChange={e => setNewStartTime(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }}
                style={{ fontSize: 12.5, border: `1px solid ${THEME.rule}`, borderRadius: 6, padding: '5px 7px', flex: 1, color: newStartTime ? THEME.ink : THEME.inkSoft }} />
              {newStartTime ? (
                <button type="button" onClick={() => setNewStartTime('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.inkSoft, display: 'flex' }}><X size={13} /></button>
              ) : (
                <span style={{ fontSize: 11, color: THEME.inkSoft, whiteSpace: 'nowrap' }}>optional — else goes to Inbox</span>
              )}
            </div>
            <button type="button" onClick={addTask} style={{
              width: '100%', background: THEME.ink, color: THEME.paper, border: 'none', borderRadius: 7,
              padding: '8px 0', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer'
            }}><Plus size={15} /> Add task</button>
          </div>

          {inboxTasks.length === 0 ? (
            <EmptyNote>Nothing waiting — add a task above.</EmptyNote>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inboxTasks.map(t => (
                <TaskCard key={t.id} task={t} deleteTask={deleteTask} deleteSeries={deleteSeries} toggleDone={toggleDone} renameTask={renameTask} editTaskFields={editTaskFields}
                  editingTime={editingTime} setEditingTime={setEditingTime} setTaskTime={setTaskTime} />
              ))}
            </div>
          )}
        </div>

        <div className="schedule-col" style={{ flex: 1, minWidth: 0 }}>
          <SectionLabel>Schedule</SectionLabel>
          <div style={{
            position: 'relative', border: `1px solid ${THEME.rule}`, borderRadius: 10, background: `radial-gradient(${THEME.rule} 1px, transparent 1px)`,
            backgroundSize: '20px 20px', backgroundColor: '#fff', overflow: 'hidden'
          }}>
            {hours.map((m, i) => (
              <div key={m} style={{
                position: 'absolute', top: i * PIXELS_PER_HOUR, left: 0, right: 0, height: PIXELS_PER_HOUR,
                borderTop: `1px solid ${THEME.rule}`, display: 'flex'
              }}>
                <div style={{
                  width: 58, flexShrink: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: THEME.inkSoft,
                  paddingTop: 4, textAlign: 'right', paddingRight: 10
                }}>{fmt12(minutesToTime(m))}</div>
              </div>
            ))}
            <div style={{ height: scheduleHeight, position: 'relative', marginLeft: 58 }}>
              {showNowLine && (
                <div ref={nowLineRef} style={{ position: 'absolute', top: nowTop, left: 0, right: 0, zIndex: 5, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: THEME.rust, marginLeft: -4, flexShrink: 0 }} />
                  <div style={{ flex: 1, height: 1.5, background: THEME.rust }} />
                </div>
              )}
              {scheduledTasks.length === 0 && (
                <div style={{ position: 'absolute', top: 24, left: 16, right: 16 }}>
                  <EmptyNote>Your day is open. Add tasks, then let AI find them a place — or set a time yourself.</EmptyNote>
                </div>
              )}
              {scheduledTasks.map(t => {
                const dragging = drag && drag.id === t.id;
                const top = dragging ? drag.top : topForStart(t.start);
                const height = Math.max(26, t.duration / 60 * PIXELS_PER_HOUR - 4);
                const meta = PRIORITY_META[t.priority];
                const previewStart = dragging ? minutesToTime(snap(DAY_START + (drag.top / PIXELS_PER_HOUR) * 60)) : t.start;
                return (
                  <div key={t.id} className="block-card" style={{
                    position: 'absolute', top, left: 8, right: 8, height, borderRadius: 7,
                    background: '#fff', border: `1px solid ${meta.color}55`, borderLeft: `4px solid ${meta.color}`,
                    padding: '6px 10px 6px 6px', boxShadow: dragging ? '2px 3px 6px rgba(0,0,0,0.15)' : '1px 1px 0 rgba(0,0,0,0.04)',
                    display: 'flex', gap: 6, overflow: 'hidden', zIndex: dragging ? 10 : 1
                  }}>
                    {t.aiGenerated && (
                      <span style={{
                        position: 'absolute', top: -8, right: 6, transform: 'rotate(-4deg)', background: THEME.pine, color: THEME.paper,
                        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.03em', padding: '2px 6px', borderRadius: 4
                      }}>✦ AI</span>
                    )}
                    <div className="drag-handle" onPointerDown={e => handlePointerDown(e, t)} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}
                      style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      <GripVertical size={14} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {t.recurrenceId && <Repeat size={10} color={THEME.inkSoft} style={{ flexShrink: 0 }} />}
                        <EditableTitle value={t.title} onSave={v => renameTask(t.id, v)} style={{ fontSize: 13, fontWeight: 600, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? THEME.inkSoft : THEME.ink }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: THEME.inkSoft }}>
                        <span>{fmt12(previewStart)}–{fmt12(addMinutes(previewStart, t.duration))}</span>
                        <button onClick={() => toggleDone(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: t.done ? THEME.pine : THEME.inkSoft, display: 'flex' }}>
                          {t.done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                        </button>
                        <button onClick={() => unschedule(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: THEME.inkSoft, textDecoration: 'underline' }}>unschedule</button>
                        <DeleteControl task={t} deleteTask={deleteTask} deleteSeries={deleteSeries} size={11} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ fontSize: 11, color: THEME.inkSoft, marginTop: 8 }}>Drag the grip to reschedule · double-click a title to rename it</div>
        </div>
      </div>
    </>
  );
}

function AuthCard({ title, subtitle, children }) {
  return (
    <div style={{ minHeight: '100vh', background: THEME.paper, color: THEME.ink, fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;1,500&family=Inter:wght@400;500;600&display=swap');`}</style>
      <div style={{ maxWidth: 380, width: '100%', border: `1px solid ${THEME.rule}`, borderRadius: 12, padding: 28, background: '#fff' }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 600, fontSize: 24, marginBottom: 6 }}>PlanForge</div>
        <div style={{ fontSize: 13, color: THEME.inkSoft, marginBottom: 22 }}>{subtitle}</div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: '100%', border: `1px solid ${THEME.rule}`, borderRadius: 6, padding: '9px 10px', fontSize: 13.5, marginBottom: 10 };
const primaryBtnStyle = (busy) => ({
  width: '100%', background: THEME.pine, color: '#fff', border: 'none', borderRadius: 8,
  padding: '11px 0', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1
});

function SetupScreen({ onActivated, onSwitchToLogin }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [orgName, setOrgName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { token, user, recoveryCode }
  const [saved, setSaved] = useState(false);

  async function activate() {
    if (!licenseKey.trim() || !ownerEmail.trim() || ownerPassword.length < 8 || !anthropicApiKey.trim()) {
      setError('Fill in your license key, email, an Anthropic API key, and a password of at least 8 characters.');
      return;
    }
    setBusy(true); setError('');
    try {
      const data = await api.createOrg({
        licenseKey: licenseKey.trim(), orgName: orgName.trim(),
        ownerEmail: ownerEmail.trim(), ownerName: ownerName.trim(), ownerPassword,
        anthropicApiKey: anthropicApiKey.trim(),
      });
      setResult(data);
    } catch (e) {
      const messages = {
        invalid_license_key: 'That license key is not valid.',
        license_already_used: 'That license key has already been used to create an organization.',
        email_already_registered: 'That email already has an account — sign in instead.',
      };
      setError(messages[e.message] || 'Could not create your organization. Check the details and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <AuthCard subtitle="Save this recovery code before continuing.">
        <div style={{ fontSize: 13, color: THEME.ink, marginBottom: 14 }}>
          If you ever forget your password, this code — and only this code — can reset it. Nobody, including you later, can recover it after you leave this screen; a new one is issued each time it's used.
        </div>
        <div style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 600, textAlign: 'center',
          background: THEME.paperDeep, border: `1px solid ${THEME.rule}`, borderRadius: 8, padding: '12px 10px', marginBottom: 14, letterSpacing: '0.03em'
        }}>{result.recoveryCode}</div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: THEME.inkSoft, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} style={{ marginTop: 2 }} />
          I've saved this somewhere safe.
        </label>
        <button onClick={() => { saveToken(result.token); onActivated(result.user); }} disabled={!saved} style={primaryBtnStyle(!saved)}>
          Continue
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle="Redeem your license key to set up your organization.">
      <input value={licenseKey} onChange={e => setLicenseKey(e.target.value)} placeholder="License key" style={inputStyle} />
      <input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Organization name (optional)" style={inputStyle} />
      <input value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="Your email" style={inputStyle} />
      <input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Your name (optional)" style={inputStyle} />
      <input type="password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)} placeholder="Choose a password" style={inputStyle} />
      <input value={anthropicApiKey} onChange={e => setAnthropicApiKey(e.target.value)} placeholder="Your Anthropic API key"
        onKeyDown={e => { if (e.key === 'Enter') activate(); }} style={{ ...inputStyle, marginBottom: 4 }} />
      <div style={{ fontSize: 11, color: THEME.inkSoft, marginBottom: 16 }}>
        Used only for your organization's AI scheduling calls — billed to your own Anthropic account.
      </div>
      <button onClick={activate} disabled={busy} style={primaryBtnStyle(busy)}>{busy ? 'Setting up…' : 'Create organization'}</button>
      {error && <div style={{ fontSize: 12.5, color: THEME.rust, marginTop: 12 }}>{error}</div>}
      <div style={{ fontSize: 12.5, color: THEME.inkSoft, textAlign: 'center', marginTop: 16 }}>
        Already have an account? <a onClick={onSwitchToLogin} style={{ color: THEME.pine, fontWeight: 600, cursor: 'pointer' }}>Sign in</a>
      </div>
    </AuthCard>
  );
}

function EmailResetScreen({ onRecovered, onSwitchToLogin, onUseOfflineCode }) {
  const [step, setStep] = useState('request'); // request | redeem
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function requestCode() {
    if (!email.trim()) return;
    setBusy(true); setError('');
    try {
      await api.forgotPassword(email.trim());
      setNotice(`If an account exists for ${email.trim()}, a reset code was just emailed to it. Codes expire in 30 minutes.`);
      setStep('redeem');
    } catch (e) {
      setError(e.message === 'email_not_configured' ? 'Email reset isn\u2019t set up on this server yet.' : 'Could not send a reset code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function redeemCode() {
    if (!code.trim() || newPassword.length < 8) {
      setError('Enter the code from your email and a new password of at least 8 characters.');
      return;
    }
    setBusy(true); setError('');
    try {
      const data = await api.resetPasswordWithEmailCode(email.trim(), code.trim().toUpperCase(), newPassword);
      saveToken(data.token);
      onRecovered(data.user);
    } catch (e) {
      setError('That code is invalid or has expired.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'redeem') {
    return (
      <AuthCard subtitle="Enter the code we emailed you.">
        {notice && <div style={{ fontSize: 12.5, color: THEME.pineDeep, background: '#EAF1EC', border: '1px solid #CFE0D5', borderRadius: 7, padding: '9px 11px', marginBottom: 16 }}>{notice}</div>}
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="Reset code from email" style={{ ...inputStyle, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.05em' }} />
        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password"
          onKeyDown={e => { if (e.key === 'Enter') redeemCode(); }} style={{ ...inputStyle, marginBottom: 16 }} />
        <button onClick={redeemCode} disabled={busy} style={primaryBtnStyle(busy)}>{busy ? 'Resetting…' : 'Reset password'}</button>
        {error && <div style={{ fontSize: 12.5, color: THEME.rust, marginTop: 12 }}>{error}</div>}
        <div style={{ fontSize: 12.5, color: THEME.inkSoft, textAlign: 'center', marginTop: 16 }}>
          <a onClick={() => setStep('request')} style={{ color: THEME.pine, fontWeight: 600, cursor: 'pointer' }}>Send another code</a> · <a onClick={onSwitchToLogin} style={{ color: THEME.pine, fontWeight: 600, cursor: 'pointer' }}>Back to sign in</a>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle="We'll email you a code to reset your password.">
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email"
        onKeyDown={e => { if (e.key === 'Enter') requestCode(); }} style={{ ...inputStyle, marginBottom: 16 }} />
      <button onClick={requestCode} disabled={busy} style={primaryBtnStyle(busy)}>{busy ? 'Sending…' : 'Email me a reset code'}</button>
      {error && <div style={{ fontSize: 12.5, color: THEME.rust, marginTop: 12 }}>{error}</div>}
      <div style={{ fontSize: 12.5, color: THEME.inkSoft, textAlign: 'center', marginTop: 16 }}>
        <a onClick={onUseOfflineCode} style={{ color: THEME.pine, fontWeight: 600, cursor: 'pointer' }}>Have an offline recovery code instead?</a>
      </div>
      <div style={{ fontSize: 12.5, color: THEME.inkSoft, textAlign: 'center', marginTop: 8 }}>
        <a onClick={onSwitchToLogin} style={{ color: THEME.pine, fontWeight: 600, cursor: 'pointer' }}>Back to sign in</a>
      </div>
    </AuthCard>
  );
}

function RecoverScreen({ onRecovered, onSwitchToLogin }) {
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);

  async function submit() {
    if (!email.trim() || !recoveryCode.trim() || newPassword.length < 8) {
      setError('Fill in your email, recovery code, and a new password of at least 8 characters.');
      return;
    }
    setBusy(true); setError('');
    try {
      const data = await api.recover(email.trim(), recoveryCode.trim(), newPassword);
      setResult(data);
    } catch (e) {
      setError('That email/recovery code combination is not valid.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <AuthCard subtitle="Password reset. Save your new recovery code before continuing.">
        <div style={{ fontSize: 13, color: THEME.ink, marginBottom: 14 }}>
          Your old recovery code no longer works — here's the one that replaces it.
        </div>
        <div style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 600, textAlign: 'center',
          background: THEME.paperDeep, border: `1px solid ${THEME.rule}`, borderRadius: 8, padding: '12px 10px', marginBottom: 14, letterSpacing: '0.03em'
        }}>{result.recoveryCode}</div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: THEME.inkSoft, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} style={{ marginTop: 2 }} />
          I've saved this somewhere safe.
        </label>
        <button onClick={() => { saveToken(result.token); onRecovered(result.user); }} disabled={!saved} style={primaryBtnStyle(!saved)}>
          Continue
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle="Reset your password using your recovery code.">
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={inputStyle} />
      <input value={recoveryCode} onChange={e => setRecoveryCode(e.target.value)} placeholder="Recovery code" style={inputStyle} />
      <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password"
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} style={{ ...inputStyle, marginBottom: 16 }} />
      <button onClick={submit} disabled={busy} style={primaryBtnStyle(busy)}>{busy ? 'Resetting…' : 'Reset password'}</button>
      {error && <div style={{ fontSize: 12.5, color: THEME.rust, marginTop: 12 }}>{error}</div>}
      <div style={{ fontSize: 12.5, color: THEME.inkSoft, textAlign: 'center', marginTop: 16 }}>
        <a onClick={onSwitchToLogin} style={{ color: THEME.pine, fontWeight: 600, cursor: 'pointer' }}>Back to sign in</a>
      </div>
    </AuthCard>
  );
}

function LoginScreen({ onLoggedIn, onSwitchToSetup, onForgotPassword }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function login() {
    if (!email.trim() || !password) return;
    setBusy(true); setError('');
    try {
      const data = await api.login(email.trim(), password);
      saveToken(data.token);
      onLoggedIn(data.user);
    } catch (e) {
      setError('Incorrect email or password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard subtitle="Sign in to your organization's PlanForge.">
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={inputStyle} />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password"
        onKeyDown={e => { if (e.key === 'Enter') login(); }} style={inputStyle} />
      <div style={{ textAlign: 'right', marginBottom: 16 }}>
        <a onClick={onForgotPassword} style={{ fontSize: 12, color: THEME.inkSoft, cursor: 'pointer' }}>Forgot password?</a>
      </div>
      <button onClick={login} disabled={busy} style={primaryBtnStyle(busy)}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {error && <div style={{ fontSize: 12.5, color: THEME.rust, marginTop: 12 }}>{error}</div>}
      <div style={{ fontSize: 12.5, color: THEME.inkSoft, textAlign: 'center', marginTop: 16 }}>
        Have a license key? <a onClick={onSwitchToSetup} style={{ color: THEME.pine, fontWeight: 600, cursor: 'pointer' }}>Create an organization</a>
      </div>
    </AuthCard>
  );
}

export default function PlanForgeApp() {
  const [status, setStatus] = useState('checking'); // checking | login | setup | email-reset | recover | ready
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      if (!hasToken()) { setStatus('login'); return; }
      try {
        const me = await api.me();
        setUser(me.user);
        setStatus('ready');
      } catch (e) {
        clearToken();
        setStatus('login');
      }
    })();
  }, []);

  function handleReady(u) { setUser(u); setStatus('ready'); }
  function logout() { clearToken(); setUser(null); setStatus('login'); }

  if (status === 'checking') return null;
  if (status === 'setup') return <SetupScreen onActivated={handleReady} onSwitchToLogin={() => setStatus('login')} />;
  if (status === 'email-reset') return <EmailResetScreen onRecovered={handleReady} onSwitchToLogin={() => setStatus('login')} onUseOfflineCode={() => setStatus('recover')} />;
  if (status === 'recover') return <RecoverScreen onRecovered={handleReady} onSwitchToLogin={() => setStatus('login')} />;
  if (status === 'login') return <LoginScreen onLoggedIn={handleReady} onSwitchToSetup={() => setStatus('setup')} onForgotPassword={() => setStatus('email-reset')} />;
  return <Planner user={user} onLogout={logout} />;
}

function TeamView() {
  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justAdded, setJustAdded] = useState(null); // { email, tempPassword }

  function load() { api.members().then(d => setMembers(d.members)).catch(() => setError('Could not load team.')); }
  useEffect(() => { load(); }, []);

  async function addMember() {
    if (!email.trim()) return;
    setBusy(true); setError(''); setJustAdded(null);
    try {
      const res = await api.addMember(email.trim(), name.trim());
      setJustAdded({ email: res.member.email, tempPassword: res.tempPassword });
      setEmail(''); setName('');
      load();
    } catch (e) {
      setError(e.message === 'already_exists' ? 'That email is already on the team.' : 'Could not add that member.');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(id) {
    try { await api.removeMember(id); load(); } catch (e) { setError('Could not remove that member.'); }
  }

  async function resetPassword(id, email) {
    try {
      const res = await api.resetMemberPassword(id);
      setJustAdded({ email, tempPassword: res.tempPassword });
    } catch (e) {
      setError('Could not reset that password.');
    }
  }

  return (
    <>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 22, marginBottom: 20 }}>Team</h1>

      <div style={{ border: `1px solid ${THEME.rule}`, borderRadius: 10, padding: 16, background: '#fff', maxWidth: 420, marginBottom: 20 }}>
        <SectionLabel>Add a member</SectionLabel>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="their@email.com"
          style={{ width: '100%', border: `1px solid ${THEME.rule}`, borderRadius: 6, padding: '7px 9px', fontSize: 13.5, marginBottom: 8 }} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)"
          style={{ width: '100%', border: `1px solid ${THEME.rule}`, borderRadius: 6, padding: '7px 9px', fontSize: 13.5, marginBottom: 10 }} />
        <button onClick={addMember} disabled={busy} style={{
          background: THEME.ink, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px',
          fontSize: 13.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1
        }}>Add member</button>
        {error && <div style={{ fontSize: 12.5, color: THEME.rust, marginTop: 10 }}>{error}</div>}
        {justAdded && (
          <div style={{ fontSize: 12.5, color: THEME.pineDeep, background: '#EAF1EC', border: '1px solid #CFE0D5', borderRadius: 7, padding: '9px 11px', marginTop: 12 }}>
            New temporary password for <strong>{justAdded.email}</strong>: <strong style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{justAdded.tempPassword}</strong> — share it with them directly; it won't be shown again.
          </div>
        )}
      </div>

      <SectionLabel>Members</SectionLabel>
      {members === null ? (
        <div style={{ fontSize: 13, color: THEME.inkSoft }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
          {members.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${THEME.rule}`,
              borderRadius: 8, padding: '9px 12px', background: '#fff'
            }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{m.name}</div>
                <div style={{ fontSize: 11.5, color: THEME.inkSoft }}>{m.email} · {m.role}</div>
              </div>
              {m.role !== 'owner' && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button onClick={() => resetPassword(m.id, m.email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.pine, fontSize: 12, fontWeight: 600 }}>
                    Reset password
                  </button>
                  <button onClick={() => removeMember(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.rust, display: 'flex' }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function OrgSettingsView() {
  const [org, setOrg] = useState(null);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function load() {
    api.getOrg().then(d => { setOrg(d.org); setName(d.org.name); }).catch(() => setError('Could not load organization settings.'));
  }
  useEffect(() => { load(); }, []);

  async function saveName() {
    if (!name.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.updateOrg({ name: name.trim() });
      setNotice('Organization name updated.');
      load();
    } catch (e) {
      setError('Could not update the organization name.');
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey() {
    if (!newKey.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.updateOrg({ anthropicApiKey: newKey.trim() });
      setNewKey('');
      setNotice('Anthropic API key updated. AI scheduling now uses the new key.');
    } catch (e) {
      setError('Could not update the Anthropic API key.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 22, marginBottom: 20 }}>Organization settings</h1>

      {org === null ? (
        <div style={{ fontSize: 13, color: THEME.inkSoft }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 420 }}>
          <div style={{ border: `1px solid ${THEME.rule}`, borderRadius: 10, padding: 16, background: '#fff' }}>
            <SectionLabel>Organization name</SectionLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={name} onChange={e => setName(e.target.value)}
                style={{ flex: 1, border: `1px solid ${THEME.rule}`, borderRadius: 6, padding: '8px 10px', fontSize: 13.5 }} />
              <button onClick={saveName} disabled={busy} style={{
                background: THEME.ink, color: '#fff', border: 'none', borderRadius: 7, padding: '0 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer'
              }}>Save</button>
            </div>
            <div style={{ fontSize: 11.5, color: THEME.inkSoft, marginTop: 10 }}>
              Licensed to {org.licensedTo} · activated {new Date(org.activatedAt).toLocaleDateString()}
            </div>
          </div>

          <div style={{ border: `1px solid ${THEME.rule}`, borderRadius: 10, padding: 16, background: '#fff' }}>
            <SectionLabel>Anthropic API key</SectionLabel>
            <div style={{ fontSize: 12, color: THEME.inkSoft, marginBottom: 10 }}>
              Used for this organization's AI scheduling. Stored encrypted — rotate it here if it's been revoked or you're switching accounts.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Paste a new key to replace the current one"
                style={{ flex: 1, border: `1px solid ${THEME.rule}`, borderRadius: 6, padding: '8px 10px', fontSize: 13 }} />
              <button onClick={rotateKey} disabled={busy || !newKey.trim()} style={{
                background: THEME.pine, color: '#fff', border: 'none', borderRadius: 7, padding: '0 16px', fontSize: 13.5, fontWeight: 600,
                cursor: busy || !newKey.trim() ? 'default' : 'pointer', opacity: busy || !newKey.trim() ? 0.6 : 1
              }}>Update</button>
            </div>
          </div>

          {notice && <div style={{ fontSize: 12.5, color: THEME.pineDeep, background: '#EAF1EC', border: '1px solid #CFE0D5', borderRadius: 7, padding: '9px 11px' }}>{notice}</div>}
          {error && <div style={{ fontSize: 12.5, color: THEME.rust }}>{error}</div>}
        </div>
      )}
    </>
  );
}

function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [newRecoveryCode, setNewRecoveryCode] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  async function submit() {
    if (next.length < 8) { setStatus('New password must be at least 8 characters.'); return; }
    setBusy(true); setStatus('');
    try {
      await api.changePassword(current, next);
      setStatus('done');
    } catch (e) {
      setStatus(e.message === 'current_password_incorrect' ? 'Current password is incorrect.' : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  }

  async function regenerateRecoveryCode() {
    setRecoveryBusy(true);
    try {
      const data = await api.regenerateRecoveryCode();
      setNewRecoveryCode(data.recoveryCode);
    } catch (e) {
      setStatus('Could not generate a new recovery code.');
    } finally {
      setRecoveryBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(35,40,46,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 340, width: '100%', border: `1px solid ${THEME.rule}` }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Change password</div>
        {status === 'done' ? (
          <div style={{ fontSize: 13, color: THEME.pineDeep, marginBottom: 16 }}>Password updated.</div>
        ) : (
          <>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="Current password" style={inputStyle} />
            <input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="New password"
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} style={{ ...inputStyle, marginBottom: 14 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={submit} disabled={busy} style={{ flex: 1, background: THEME.pine, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 0', fontSize: 13.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
            {status && <div style={{ fontSize: 12, color: THEME.rust, marginTop: 10 }}>{status}</div>}
          </>
        )}

        <div style={{ borderTop: `1px solid ${THEME.rule}`, marginTop: 20, paddingTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Recovery code</div>
          <div style={{ fontSize: 12, color: THEME.inkSoft, marginBottom: 10 }}>
            Lost the one from setup? Generate a new one — the old one stops working immediately.
          </div>
          {newRecoveryCode ? (
            <div style={{
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, fontWeight: 600, textAlign: 'center',
              background: THEME.paperDeep, border: `1px solid ${THEME.rule}`, borderRadius: 8, padding: '10px', letterSpacing: '0.03em'
            }}>{newRecoveryCode}</div>
          ) : (
            <button onClick={regenerateRecoveryCode} disabled={recoveryBusy} style={{ background: '#fff', border: `1px solid ${THEME.rule}`, borderRadius: 7, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
              {recoveryBusy ? 'Generating…' : 'Generate new recovery code'}
            </button>
          )}
        </div>

        <button onClick={onClose} style={{ width: '100%', background: THEME.ink, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 0', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginTop: 18 }}>Done</button>
      </div>
    </div>
  );
}

function EditableTitle({ value, onSave, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <input
        autoFocus value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { onSave(draft); setEditing(false); } if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
        onBlur={() => { if (draft.trim()) onSave(draft); else setDraft(value); setEditing(false); }}
        style={{ ...style, border: `1px solid ${THEME.rule}`, borderRadius: 4, padding: '1px 4px', width: '100%' }}
      />
    );
  }
  return (
    <div className="editable-title" onDoubleClick={() => { setDraft(value); setEditing(true); }} style={style}>{value}</div>
  );
}

function DeleteControl({ task, deleteTask, deleteSeries, size = 14 }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <button onClick={() => deleteTask(task.id)} style={{ ...miniBtn }}>This</button>
        <button onClick={() => deleteSeries(task.recurrenceId, task.date)} style={{ ...miniBtn }}>All future</button>
        <button onClick={() => setConfirm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.inkSoft, padding: 0, display: 'flex' }}><X size={size} /></button>
      </span>
    );
  }
  return (
    <button onClick={() => task.recurrenceId ? setConfirm(true) : deleteTask(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.rust, padding: 0, display: 'flex' }}>
      <Trash2 size={size} />
    </button>
  );
}

function TaskCard({ task, deleteTask, deleteSeries, toggleDone, renameTask, editTaskFields, editingTime, setEditingTime, setTaskTime }) {
  const meta = PRIORITY_META[task.priority];
  const isEditing = editingTime === task.id;
  const [editingFields, setEditingFields] = useState(false);
  return (
    <div className="task-card" style={{
      border: `1px solid ${THEME.rule}`, borderRadius: 9, padding: '10px 12px', background: '#fff', position: 'relative'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button onClick={() => toggleDone(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2, color: task.done ? THEME.pine : THEME.inkSoft }}>
          {task.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {task.recurrenceId && <Repeat size={11} color={THEME.inkSoft} style={{ flexShrink: 0 }} />}
            <EditableTitle value={task.title} onSave={v => renameTask(task.id, v)} style={{ fontSize: 14, fontWeight: 500, textDecoration: task.done ? 'line-through' : 'none', color: task.done ? THEME.inkSoft : THEME.ink }} />
          </div>
          {editingFields ? (
            <div style={{ marginTop: 6, marginBottom: 4 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>
                {DURATIONS.map(d => (
                  <button key={d} onClick={() => editTaskFields(task.id, { duration: d })} className="pill-btn" style={pillStyle(task.duration === d)}>{formatDuration(d)}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {Object.entries(PRIORITY_META).map(([k, v]) => (
                  <button key={k} onClick={() => editTaskFields(task.id, { priority: k })} className="pill-btn" style={{
                    ...pillStyle(task.priority === k), borderColor: task.priority === k ? v.color : THEME.rule,
                    color: task.priority === k ? v.color : THEME.inkSoft, background: task.priority === k ? `${v.color}14` : '#fff'
                  }}>{v.label}</button>
                ))}
                <button onClick={() => setEditingFields(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.inkSoft, marginLeft: 4 }}><X size={13} /></button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditingFields(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: meta.color, fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, display: 'inline-block' }} />{meta.label}
              </span>
              <span style={{ fontSize: 11, color: THEME.inkSoft, fontFamily: "'IBM Plex Mono', monospace" }}>{formatDuration(task.duration)}</span>
            </button>
          )}
          {isEditing ? (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="time" autoFocus onKeyDown={e => { if (e.key === 'Enter' && e.target.value) setTaskTime(task.id, e.target.value); }}
                onBlur={e => { if (e.target.value) setTaskTime(task.id, e.target.value); else setEditingTime(null); }}
                style={{ fontSize: 12, border: `1px solid ${THEME.rule}`, borderRadius: 5, padding: '3px 5px' }} />
              <button onClick={() => setEditingTime(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.inkSoft }}><X size={13} /></button>
            </div>
          ) : (
            <button onClick={() => setEditingTime(task.id)} style={{
              marginTop: 7, display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11.5, color: THEME.pine, fontWeight: 600, padding: 0
            }}><Clock size={12} /> Set a time</button>
          )}
        </div>
        <div className="del-btn">
          <DeleteControl task={task} deleteTask={deleteTask} deleteSeries={deleteSeries} size={14} />
        </div>
      </div>
    </div>
  );
}

function WeekView({ weekDays, tasks, onPick }) {
  const today = dateKey(new Date());
  return (
    <>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 22, marginBottom: 20 }}>This week</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
        {weekDays.map(d => {
          const k = dateKey(d);
          const dayTasks = tasks.filter(t => t.date === k);
          const scheduled = dayTasks.filter(t => t.start);
          const totalMin = scheduled.reduce((s, t) => s + t.duration, 0);
          const isToday = k === today;
          const dots = dayTasks.slice(0, 6);
          return (
            <div key={k} onClick={() => onPick(d)} className="day-cell" style={{
              border: `1px solid ${isToday ? THEME.pine : THEME.rule}`, borderRadius: 10, padding: '14px 10px', background: '#fff', minHeight: 130
            }}>
              <div style={{ fontSize: 11, color: THEME.inkSoft, fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase' }}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, marginTop: 2, color: isToday ? THEME.pine : THEME.ink }}>{d.getDate()}</div>
              <div style={{ marginTop: 10, fontSize: 12, color: THEME.inkSoft }}>
                {dayTasks.length === 0 ? '—' : `${dayTasks.length} task${dayTasks.length > 1 ? 's' : ''}`}
              </div>
              {totalMin > 0 && (
                <div style={{ fontSize: 11.5, color: THEME.pine, fontFamily: "'IBM Plex Mono', monospace", marginTop: 3 }}>{formatDuration(totalMin)} planned</div>
              )}
              {dots.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                  {dots.map(t => (
                    <span key={t.id} title={t.title} style={{
                      width: 7, height: 7, borderRadius: '50%', background: PRIORITY_META[t.priority].color,
                      opacity: t.done ? 0.35 : 1, display: 'inline-block'
                    }} />
                  ))}
                  {dayTasks.length > 6 && <span style={{ fontSize: 10, color: THEME.inkSoft }}>+{dayTasks.length - 6}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function MobileMenuItem({ icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 8px',
      border: 'none', background: 'none', fontSize: 14, color: THEME.ink, cursor: 'pointer', borderRadius: 6
    }}>{icon} {label}</button>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: THEME.inkSoft, marginBottom: 10 }}>{children}</div>;
}

function EmptyNote({ children }) {
  return <div style={{ fontSize: 13, color: THEME.inkSoft, fontStyle: 'italic', border: `1px dashed ${THEME.rule}`, borderRadius: 8, padding: '12px 14px' }}>{children}</div>;
}

function pillStyle(active) {
  return {
    fontSize: 12, padding: '4px 9px', borderRadius: 6, border: `1px solid ${active ? THEME.ink : THEME.rule}`,
    background: active ? THEME.ink : '#fff', color: active ? '#fff' : THEME.inkSoft, fontWeight: 500
  };
}

const iconBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: THEME.ink, display: 'flex', padding: 6, borderRadius: 6 };
const smallBtn = { fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 };
const miniBtn = { fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', background: '#fff', border: `1px solid ${THEME.rule}`, color: THEME.rust };
