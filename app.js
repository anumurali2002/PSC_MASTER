// PSC MASTER - online version. Data lives in Supabase; this file only draws the screens.
const cfg = window.PSC_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
const $ = id => document.getElementById(id);
let me = null, questions = [], learners = [], catalog = [], exam = [], answers = {}, index = 0;
let current = { examId: null, title: "" }, lastReview = [], editingQuestionId = null;

// ---------- small helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ok = async p => { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; };
function toast(msg, bad) { const t = $("toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), bad ? 7000 : 3500); }
async function run(fn) { try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); } }
function shuffle(a) { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }
async function fetchAll(table, cols) { let out = [], from = 0; for (;;) { const d = await ok(sb.from(table).select(cols).order("id", { ascending: true }).range(from, from + 999)); out = out.concat(d); if (d.length < 1000) break; from += 1000; } return out; }
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const fmtDate = d => new Date(d).toLocaleDateString();

// ---------- sign in / out ----------
function showLogin() { $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); }
async function login() {
  const email = $("email").value.trim(), password = $("password").value;
  $("loginError").textContent = "";
  if (!email || !password) { $("loginError").textContent = "Enter your email and password."; return; }
  $("loginBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $("loginBtn").disabled = false;
  if (error) { $("loginError").textContent = /invalid login/i.test(error.message) ? "Email or password is incorrect." : error.message; return; }
  await run(enterApp);
}
async function enterApp() {
  const { data } = await sb.auth.getSession();
  const uid = data.session && data.session.user.id;
  if (!uid) { showLogin(); return; }
  const rows = await ok(sb.from("profiles").select("id,email,name,role").eq("id", uid));
  me = rows[0];
  if (!me) { await sb.auth.signOut(); showLogin(); $("loginError").textContent = "Your account is not set up yet. Please contact the administrator."; return; }
  $("password").value = "";
  $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden");
  $("currentUser").textContent = me.name || me.email;
  const admin = me.role === "admin";
  $("rolePill").textContent = admin ? "Administrator" : "Learner";
  document.querySelectorAll(".admin-only").forEach(x => x.classList.toggle("hidden", !admin));
  document.querySelectorAll(".learner-only").forEach(x => x.classList.toggle("hidden", admin));
  if (admin) { go("manage"); await renderManage(); } else { go("dashboard"); await renderDashboard(); }
}
async function logout() { await sb.auth.signOut(); me = null; exam = []; questions = []; $("email").value = ""; $("password").value = ""; showLogin(); }

function go(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $(page + "Page").classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $("pageTitle").textContent = ({ dashboard: "Overview", subjects: "Subjects & topics", revision: "Wrong answers", manage: "Manage questions", learners: "Users", examsets: "Examinations", exam: "Practice test", result: "Test result" })[page] || page;
}

// ---------- learner: overview, subjects, practice ----------
async function loadCatalog() { catalog = await ok(sb.rpc("get_catalog")); }
async function renderDashboard() {
  const [att] = await Promise.all([ok(sb.from("attempts").select("total,correct").eq("user_id", me.id)), loadCatalog()]);
  const attempted = att.reduce((a, x) => a + x.total, 0), correct = att.reduce((a, x) => a + x.correct, 0);
  $("testsStat").textContent = att.length; $("attemptedStat").textContent = attempted; $("correctStat").textContent = correct;
  $("accuracyStat").textContent = attempted ? pct(correct, attempted) + "%" : "—";
  const subjects = [...new Set(catalog.map(c => c.subject))];
  $("dashboardSubjects").innerHTML = subjects.map((s, i) => `<button class="subject-tile" data-si="${i}"><b>${esc(s)}</b><span>${catalog.filter(c => c.subject === s).reduce((a, c) => a + c.n, 0)} questions · Practise →</span></button>`).join("") || '<p class="muted">No questions added yet.</p>';
  document.querySelectorAll("[data-si]").forEach(b => b.onclick = () => run(() => startPractice(subjects[Number(b.dataset.si)], null)));
}
async function renderSubjects() {
  await loadCatalog();
  const subjects = [...new Set(catalog.map(c => c.subject))];
  $("subjectList").innerHTML = subjects.map((s, i) => `<div class="subject-block"><h3>${esc(s)}</h3>${catalog.map((c, j) => c.subject === s ? `<button class="topic-row" data-ci="${j}"><span>${esc(c.topic)}</span><small>${c.n} questions　→</small></button>` : "").join("")}</div>`).join("") || '<p class="muted">The question bank is empty. Ask the admin to add questions.</p>';
  document.querySelectorAll("[data-ci]").forEach(b => b.onclick = () => { const c = catalog[Number(b.dataset.ci)]; run(() => startPractice(c.subject, c.topic)); });
}
async function startPractice(subject, topic) {
  const items = await ok(sb.rpc("get_practice_questions", { p_subject: subject, p_topic: topic }));
  beginExam(items, topic || subject, null);
}
function beginExam(items, title, examId) {
  if (!items.length) { toast("No questions found.", true); return; }
  current = { examId, title }; exam = items; answers = {}; index = 0;
  $("examTopic").textContent = title; go("exam"); renderQuestion();
}
function renderQuestion() {
  const q = exam[index];
  $("questionNumber").textContent = `QUESTION ${index + 1}`; $("questionCount").textContent = `${index + 1} / ${exam.length}`;
  $("difficultyLabel").textContent = q.difficulty || ""; $("questionText").textContent = q.qtext;
  $("options").innerHTML = q.options.map((o, i) => `<button class="option ${answers[q.id] === i ? "selected" : ""}" data-option="${i}"><span class="letter">${"ABCD"[i]}</span>${esc(o)}</button>`).join("");
  document.querySelectorAll("[data-option]").forEach(b => b.onclick = () => { answers[q.id] = Number(b.dataset.option); renderQuestion(); });
  $("prevBtn").disabled = index === 0;
  $("nextBtn").textContent = index === exam.length - 1 ? "Finish questions" : "Next →";
  $("progressBar").style.width = ((index + 1) / exam.length * 100) + "%";
  $("answeredCount").textContent = `${Object.keys(answers).length} of ${exam.length} answered`;
}
async function finishExam() {
  $("nextBtn").disabled = $("submitBtn").disabled = true;
  try {
    const g = current.examId !== null
      ? await ok(sb.rpc("submit_exam", { p_exam_id: current.examId, p_answers: answers }))
      : await ok(sb.rpc("submit_practice", { p_qids: exam.map(q => q.id), p_answers: answers }));
    showResult(g);
    run(renderDashboard);
  } finally { $("nextBtn").disabled = $("submitBtn").disabled = false; }
}
function showResult(g) {
  lastReview = g.review;
  $("scorePercent").textContent = pct(g.correct, g.total) + "%";
  $("resultCorrect").textContent = g.correct; $("resultWrong").textContent = g.wrong; $("resultSkipped").textContent = g.skipped; $("resultTotal").textContent = g.total;
  $("answerReview").classList.add("hidden"); go("result");
}
function renderReview() {
  $("answerReview").innerHTML = lastReview.map((q, i) => {
    const a = q.chosen, good = a === q.answer;
    return `<article class="answer-item"><b>${i + 1}. ${esc(q.qtext)}</b><p class="${good ? "correct" : a === null ? "" : "wrong"}">${a === null ? "Not attempted" : (good ? "Correct · " : "Incorrect · ") + "Your answer: " + esc(q.options[a])}</p><p><b>Correct answer:</b> ${"ABCD"[q.answer]}. ${esc(q.options[q.answer])}</p><p>${esc(q.explanation || "No explanation added.")}</p></article>`;
  }).join("");
  $("answerReview").classList.remove("hidden");
}

// ---------- learner: assigned exams, revision ----------
async function renderExamSets() {
  const list = await ok(sb.rpc("get_my_exams"));
  $("examSetList").innerHTML = list.map(s => `<article class="admin-q"><div class="admin-q-content"><b>${esc(s.title)}</b><br><small>${esc(fmtDate(s.created_at))} · ${Number(s.size)} questions · ${esc((s.subjects || []).join(", "))}</small><p class="admin-q-answer">${s.attempt_id ? "Completed · Score: " + s.correct + "/" + s.total + " (" + pct(s.correct, s.total) + "%)" : "Not taken yet"}</p></div><div class="admin-q-actions">${s.attempt_id ? `<button class="secondary small-btn" type="button" data-review-attempt="${s.attempt_id}">Review</button>` : `<button class="primary small-btn" type="button" data-start-exam="${s.id}" data-title="${esc(s.title)}">Start</button>`}</div></article>`).join("") || '<p class="muted">No examinations have been assigned to you yet.</p>';
  document.querySelectorAll("[data-start-exam]").forEach(b => b.onclick = () => run(async () => { const paper = await ok(sb.rpc("get_my_paper", { p_exam_id: Number(b.dataset.startExam) })); beginExam(paper, b.dataset.title, Number(b.dataset.startExam)); }));
  document.querySelectorAll("[data-review-attempt]").forEach(b => b.onclick = () => run(async () => {
    const rows = await ok(sb.from("attempt_details").select("details").eq("attempt_id", Number(b.dataset.reviewAttempt)));
    if (!rows.length) { toast("Details for this attempt are not available.", true); return; }
    const d = rows[0].details, correct = d.filter(x => x.chosen === x.answer).length, skipped = d.filter(x => x.chosen === null).length;
    showResult({ review: d, total: d.length, correct, skipped, wrong: d.length - correct - skipped }); renderReview();
  }));
}
async function renderRevision() {
  const list = await ok(sb.rpc("get_my_revision"));
  $("revisionList").innerHTML = list.length ? list.map(q => `<article class="revision-q"><b>${esc(q.qtext)}</b><p><small>${esc(q.subject)} · ${esc(q.topic)}</small></p><p>Correct answer: ${"ABCD"[q.answer]}. ${esc(q.options[q.answer])}</p><small>${esc(q.explanation || "")}</small></article>`).join("") : '<p class="muted">No incorrect answers saved yet. Complete a test to build your revision list.</p>';
}

// ---------- admin: questions ----------
async function loadQuestions() { questions = await fetchAll("questions", "*"); }
async function renderManage() {
  const [, lr] = await Promise.all([loadQuestions(), ok(sb.from("profiles").select("id,email,name").eq("role", "learner"))]);
  learners = lr; renderAdminQuestions(); await renderAdminExamSets();
}
function renderAdminQuestions() {
  $("questionTotal").textContent = questions.length + " questions in your bank";
  $("adminQuestionList").innerHTML = questions.map(q => `<article class="admin-q"><div class="admin-q-content"><b>${esc(q.qtext)}</b><br><small>${esc(q.subject)} · ${esc(q.topic)} · ${esc(q.difficulty || "Intermediate")}</small><p class="admin-q-answer">Correct answer: ${"ABCD"[q.answer]}. ${esc(q.options[q.answer])}</p></div><div class="admin-q-actions"><button class="secondary small-btn" type="button" data-edit-question="${Number(q.id)}">Edit</button><button class="text-button danger-text small-btn" type="button" data-delete-question="${Number(q.id)}">Delete</button></div></article>`).join("") || '<p class="muted">No questions yet.</p>';
  document.querySelectorAll("[data-edit-question]").forEach(b => b.onclick = () => editQuestion(Number(b.dataset.editQuestion)));
  document.querySelectorAll("[data-delete-question]").forEach(b => b.onclick = () => run(() => deleteQuestion(Number(b.dataset.deleteQuestion))));
  renderGenSubjects(); renderGenLearners();
}
async function saveQuestion(e) {
  e.preventDefault();
  const q = { subject: $("qSubject").value.trim(), topic: $("qTopic").value.trim(), qtext: $("qText").value.trim(), options: [0, 1, 2, 3].map(i => $("opt" + i).value.trim()), answer: Number($("qAnswer").value), difficulty: $("qDifficulty").value, explanation: $("qExplanation").value.trim() };
  if (!q.subject || !q.topic || !q.qtext || q.options.some(x => !x)) { $("formMessage").textContent = "Please complete the subject, topic, question and all four options."; return; }
  $("saveQuestionBtn").disabled = true;
  try {
    if (editingQuestionId !== null) { await ok(sb.from("questions").update(q).eq("id", editingQuestionId)); $("formMessage").textContent = "Question updated."; }
    else { await ok(sb.from("questions").insert(q)); $("formMessage").textContent = "Question added."; }
    resetQuestionForm(); await loadQuestions(); renderAdminQuestions();
  } finally { $("saveQuestionBtn").disabled = false; }
}
function resetQuestionForm() { $("questionForm").reset(); editingQuestionId = null; $("questionFormTitle").textContent = "Add a question"; $("saveQuestionBtn").textContent = "Add question"; $("cancelEditBtn").classList.add("hidden"); }
function cancelQuestionEdit() { resetQuestionForm(); $("formMessage").textContent = "Editing cancelled."; }
function editQuestion(id) {
  const q = questions.find(x => x.id === id); if (!q) return;
  editingQuestionId = id;
  $("qSubject").value = q.subject; $("qTopic").value = q.topic; $("qText").value = q.qtext;
  q.options.forEach((o, i) => $("opt" + i).value = o);
  $("qAnswer").value = String(q.answer); $("qDifficulty").value = q.difficulty || "Intermediate"; $("qExplanation").value = q.explanation || "";
  $("questionFormTitle").textContent = "Edit question"; $("saveQuestionBtn").textContent = "Save changes"; $("cancelEditBtn").classList.remove("hidden");
  $("formMessage").textContent = "Editing question. Make your changes and save.";
  $("questionForm").scrollIntoView({ behavior: "smooth", block: "start" });
}
async function deleteQuestion(id) {
  if (!questions.find(x => x.id === id)) return;
  if (!confirm("Delete this question? This cannot be undone unless you have a CSV export.")) return;
  await ok(sb.from("questions").delete().eq("id", id));
  if (editingQuestionId === id) resetQuestionForm();
  await loadQuestions(); renderAdminQuestions();
}

// ---------- admin: CSV import / export ----------
function parseCSV(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quoted) { if (c === '"' && n === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}
function importQuestions() {
  const file = $("importFile").files[0];
  if (!file) { $("importMessage").textContent = "Please choose a CSV file first."; return; }
  const reader = new FileReader();
  reader.onload = () => run(async () => {
    try {
      const rows = parseCSV(String(reader.result || "").replace(/^\uFEFF/, ""));
      if (rows.length < 2) throw new Error("The file has no question rows.");
      const headers = rows[0].map(h => h.trim().toLowerCase());
      const missing = ["subject", "topic", "question", "a", "b", "c", "d", "correct"].filter(h => !headers.includes(h));
      if (missing.length) throw new Error("Missing columns: " + missing.join(", "));
      const col = n => headers.indexOf(n), added = [];
      rows.slice(1).forEach((r, i) => {
        const get = n => String(r[col(n)] ?? "").trim(), answer = "ABCD".indexOf(get("correct").toUpperCase());
        if (!get("subject") || !get("topic") || !get("question") || ["a", "b", "c", "d"].some(k => !get(k)) || answer < 0) throw new Error("Please check row " + (i + 2) + ": all core fields are required and Correct must be A, B, C or D.");
        added.push({ subject: get("subject"), topic: get("topic"), qtext: get("question"), options: ["a", "b", "c", "d"].map(get), answer, difficulty: get("difficulty") || "Intermediate", explanation: get("explanation") });
      });
      $("importMessage").textContent = "Importing " + added.length + " questions…";
      for (let i = 0; i < added.length; i += 200) await ok(sb.from("questions").insert(added.slice(i, i + 200)));
      await loadQuestions(); renderAdminQuestions();
      $("importMessage").textContent = added.length + " questions imported successfully."; $("importFile").value = "";
    } catch (err) { $("importMessage").textContent = "Import failed: " + err.message; }
  });
  reader.readAsText(file);
}
function downloadTemplate() {
  const csv = 'Subject,Topic,Question,A,B,C,D,Correct,Difficulty,Explanation\n"Indian Constitution","Fundamental Rights","Which Article guarantees equality before the law?","Article 12","Article 14","Article 19","Article 21","B","Basic","Article 14 guarantees equality before the law."\n';
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "PSC_MASTER_question_template.csv"; a.click(); URL.revokeObjectURL(a.href);
}
function exportCSV() {
  const rows = [["Subject", "Topic", "Question", "A", "B", "C", "D", "Correct", "Difficulty", "Explanation"], ...questions.map(q => [q.subject, q.topic, q.qtext, ...q.options, "ABCD"[q.answer], q.difficulty, q.explanation])];
  const csv = "\uFEFF" + rows.map(r => r.map(v => '"' + String(v ?? "").replaceAll('"', '""') + '"').join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "psc-master-questions.csv"; a.click(); URL.revokeObjectURL(a.href);
}

// ---------- admin: exam generator ----------
function snapshotQuestion(q) {
  const perm = shuffle([0, 1, 2, 3]);
  return { id: q.id, subject: q.subject, topic: q.topic, qtext: q.qtext, difficulty: q.difficulty || "Intermediate", explanation: q.explanation || "", options: perm.map(i => q.options[i]), answer: perm.indexOf(q.answer) };
}
const checked = sel => [...document.querySelectorAll(sel + " input:checked")].map(x => x.value);
function updateGenPool() { const s = checked("#genSubjects"); $("genPool").textContent = s.length ? questions.filter(q => s.includes(q.subject)).length + " questions available in the selected subjects." : "Select at least one subject."; }
function renderChecks(boxId, items, labelFn) {
  const box = $(boxId), had = box.children.length > 0, prev = new Set(checked("#" + boxId));
  box.innerHTML = items.map(it => `<label class="check-item"><input type="checkbox" value="${esc(it.value)}" ${(!had || prev.has(String(it.value))) ? "checked" : ""}><span>${labelFn(it)}</span></label>`).join("") || '<p class="muted tiny">Nothing to choose yet.</p>';
}
function renderGenSubjects() {
  const subs = [...new Set(questions.map(q => q.subject))];
  renderChecks("genSubjects", subs.map(s => ({ value: s, n: questions.filter(q => q.subject === s).length })), it => `${esc(it.value)} <small>(${it.n})</small>`);
  $("genSubjects").querySelectorAll("input").forEach(i => i.onchange = updateGenPool); updateGenPool();
}
function renderGenLearners() { renderChecks("genLearners", learners.map(l => ({ value: l.id, label: l.name || l.email })), it => esc(it.label)); }
async function generateExamSet() {
  const msg = $("genMessage"), fail = t => { msg.className = "error"; msg.textContent = t; };
  const subs = checked("#genSubjects"), ids = checked("#genLearners"), size = Number($("genSize").value);
  if (!subs.length) return fail("Select at least one subject.");
  if (!ids.length) return fail("Select at least one learner.");
  if (!Number.isInteger(size) || size < 1) return fail("Enter a whole number of questions (1 or more).");
  const pool = questions.filter(q => subs.includes(q.subject));
  if (size > pool.length) return fail("Only " + pool.length + " questions are available in the selected subjects. Lower the number or add questions.");
  const title = $("genTitle").value.trim() || ("Exam " + new Date().toLocaleDateString());
  $("genBtn").disabled = true;
  try {
    const created = await ok(sb.from("exams").insert({ title, size, subjects: subs }).select("id"));
    const examId = created[0].id;
    try { await ok(sb.from("exam_papers").insert(ids.map(id => ({ exam_id: examId, learner_id: id, items: shuffle(pool).slice(0, size).map(snapshotQuestion) })))); }
    catch (err) { await sb.from("exams").delete().eq("id", examId); throw err; }
    $("genTitle").value = ""; msg.className = "success"; msg.textContent = "Exam created: a separate " + size + "-question paper for each of " + ids.length + " learners.";
    await renderAdminExamSets();
  } finally { $("genBtn").disabled = false; }
}
async function renderAdminExamSets() {
  const [exams, papers, attempts] = await Promise.all([ok(sb.from("exams").select("id,title,size,subjects,created_at").order("created_at", { ascending: false })), ok(sb.from("exam_papers").select("exam_id,learner_id")), fetchAll("attempts", "id,user_id,exam_id,total,correct,wrong,skipped")]);
  const nameOf = id => { const l = learners.find(x => x.id === id); return l ? (l.name || l.email) : "(removed learner)"; };
  $("examSetTotal").textContent = exams.length + (exams.length === 1 ? " examination" : " examinations");
  $("adminExamList").innerHTML = exams.map(s => {
    const assigned = papers.filter(p => p.exam_id === s.id).map(p => p.learner_id), res = Object.fromEntries(attempts.filter(a => a.exam_id === s.id).map(a => [a.user_id, a]));
    const done = assigned.filter(id => res[id]).length;
    const rows = assigned.map(id => { const r = res[id]; return `<tr><td>${esc(nameOf(id))}</td><td>${r ? r.correct + "/" + r.total + " (" + pct(r.correct, r.total) + "%)" : "Not taken"}</td><td>${r ? r.wrong : "—"}</td><td>${r ? r.skipped : "—"}</td></tr>`; }).join("");
    return `<article class="admin-q"><div class="admin-q-content"><b>${esc(s.title)}</b><br><small>${esc(fmtDate(s.created_at))} · ${Number(s.size)} questions · ${esc((s.subjects || []).join(", "))}</small><p class="admin-q-answer">${done} of ${assigned.length} learners completed</p><details><summary class="tiny">View results</summary><table class="result-table"><thead><tr><th>Learner</th><th>Score</th><th>Wrong</th><th>Skipped</th></tr></thead><tbody>${rows}</tbody></table></details></div><div class="admin-q-actions"><button class="text-button danger-text small-btn" type="button" data-delete-exam="${Number(s.id)}" data-title="${esc(s.title)}">Delete</button></div></article>`;
  }).join("") || '<p class="muted">No examinations generated yet.</p>';
  document.querySelectorAll("[data-delete-exam]").forEach(b => b.onclick = () => run(async () => {
    if (!confirm("Delete the examination \"" + b.dataset.title + "\" and all learners' papers for it? Recorded scores stay in the learners' statistics.")) return;
    await ok(sb.from("exams").delete().eq("id", Number(b.dataset.deleteExam))); await renderAdminExamSets();
  }));
}

// ---------- admin: learners ----------
async function apiUsers(method, body) {
  const { data } = await sb.auth.getSession();
  const token = data.session && data.session.access_token;
  const res = await fetch("/api/users", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}
async function renderLearners() {
  const [payload, attempts] = await Promise.all([apiUsers("GET"), fetchAll("attempts", "id,user_id,total,correct,created_at")]);
  const users = payload.users || [];
  $("learnerList").innerHTML = users.map(u => {
    const a = attempts.filter(x => x.user_id === u.id), t = a.reduce((s, x) => s + x.total, 0), c = a.reduce((s, x) => s + x.correct, 0), last = a.map(x => x.created_at).sort().pop();
    const isAdmin = u.role === "admin";
    return `<article class="admin-q"><div class="admin-q-content"><b>${esc(u.name || u.email)}</b><br><small>${esc(u.email)}</small><p class="admin-q-answer"><span class="pill">${isAdmin ? "Administrator" : "Learner"}</span> · ${a.length} tests · ${t} questions attempted · accuracy ${t ? pct(c, t) + "%" : "—"}${last ? " · last active " + esc(fmtDate(last)) : ""}</p></div><div class="admin-q-actions"><select class="secondary small-btn" data-user-role="${esc(u.id)}" aria-label="Role for ${esc(u.email)}"><option value="learner" ${isAdmin ? "" : "selected"}>Learner</option><option value="admin" ${isAdmin ? "selected" : ""}>Admin</option></select><button class="text-button danger-text small-btn" type="button" data-delete-user="${esc(u.id)}" data-email="${esc(u.email)}">Delete</button></div></article>`;
  }).join("") || '<p class="muted">No users yet.</p>';
  document.querySelectorAll("[data-user-role]").forEach(s => s.onchange = () => run(async () => {
    await apiUsers("PATCH", { id: s.dataset.userRole, role: s.value });
    toast("Role updated.");
    await renderLearners();
  }));
  document.querySelectorAll("[data-delete-user]").forEach(b => b.onclick = () => run(async () => {
    if (!confirm("Delete " + b.dataset.email + "? This cannot be undone.")) return;
    await apiUsers("DELETE", { id: b.dataset.deleteUser });
    toast("User deleted.");
    await renderLearners();
  }));
}
async function createUser(e) {
  e.preventDefault();
  const body = {
    name: $("newUserName").value.trim(),
    email: $("newUserEmail").value.trim(),
    password: $("newUserPassword").value,
    role: $("newUserRole").value
  };
  $("createUserBtn").disabled = true;
  $("userFormMessage").textContent = "Creating user…";
  try {
    await apiUsers("POST", body);
    $("userForm").reset();
    $("userFormMessage").textContent = "User created.";
    await renderLearners();
  } catch (err) { $("userFormMessage").textContent = err.message; }
  finally { $("createUserBtn").disabled = false; }
}

// ---------- wiring ----------
$("loginBtn").onclick = login;
$("password").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
$("email").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
$("logoutBtn").onclick = () => run(logout);
document.querySelectorAll(".nav-item").forEach(b => b.onclick = () => run(async () => {
  const p = b.dataset.page; go(p);
  if (p === "subjects") await renderSubjects(); if (p === "revision") await renderRevision(); if (p === "examsets") await renderExamSets();
  if (p === "manage") await renderManage(); if (p === "learners") await renderLearners(); if (p === "dashboard") await renderDashboard();
}));
document.querySelectorAll("[data-goto]").forEach(b => b.onclick = () => run(async () => { go(b.dataset.goto); await renderSubjects(); }));
$("prevBtn").onclick = () => { if (index > 0) { index--; renderQuestion(); } };
$("nextBtn").onclick = () => { if (index < exam.length - 1) { index++; renderQuestion(); } else if (confirm("Finish and submit this test?")) run(finishExam); };
$("submitBtn").onclick = () => { if (confirm("Submit this test now?")) run(finishExam); };
$("reviewBtn").onclick = renderReview;
$("backDashboard").onclick = () => run(async () => { go("dashboard"); await renderDashboard(); });
$("questionForm").onsubmit = e => run(() => saveQuestion(e));
$("cancelEditBtn").onclick = cancelQuestionEdit;
$("exportBtn").onclick = exportCSV; $("importBtn").onclick = importQuestions; $("templateBtn").onclick = downloadTemplate;
$("genBtn").onclick = () => run(generateExamSet);
$("userForm").onsubmit = e => run(() => createUser(e));
run(async () => { const { data } = await sb.auth.getSession(); if (data.session) await enterApp(); else showLogin(); });
