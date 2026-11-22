'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import SiteFooter from '@/components/SiteFooter'
import { createClient } from '@/lib/supabase/client'
import type {
  Attempt,
  CatalogItem,
  ExamSummary,
  GradeResult,
  ManagedUser,
  Profile,
  Question,
  ReviewItem,
  Role
} from '@/lib/types'

type Result = { data: any; error: { message: string } | null }
type AdminExam = { id: number; title: string; size: number; subjects: string[]; created_at: string }
type ExamPaperLink = { exam_id: number; learner_id: string }

const sb = createClient()

const pageTitles: Record<string, string> = {
  dashboard: 'Overview',
  subjects: 'Subjects & topics',
  examsets: 'Examinations',
  revision: 'Wrong answers',
  manage: 'Manage questions',
  learners: 'Users',
  exam: 'Practice test',
  result: 'Test result'
}

async function ok<T>(promise: PromiseLike<Result>): Promise<T> {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data as T
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).order('id', { ascending: true }).range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
    from += 1000
  }
  return out
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 100) : 0
}

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString()
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    if (quoted) {
      if (c === '"' && n === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(v => String(v).trim() !== ''))
}

function downloadFile(name: string, content: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

const emptyQuestionForm = {
  subject: '',
  topic: '',
  qtext: '',
  options: ['', '', '', ''],
  answer: '0',
  difficulty: 'Intermediate',
  explanation: ''
}

export default function AppClient() {
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<Profile | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState('dashboard')
  const [toastState, setToastState] = useState({ msg: '', bad: false })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [examSets, setExamSets] = useState<ExamSummary[]>([])
  const [revision, setRevision] = useState<Question[]>([])
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [allAttempts, setAllAttempts] = useState<Attempt[]>([])
  const [learners, setLearners] = useState<Profile[]>([])
  const [adminExams, setAdminExams] = useState<AdminExam[]>([])
  const [examPapers, setExamPapers] = useState<ExamPaperLink[]>([])

  const [exam, setExam] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [index, setIndex] = useState(0)
  const [current, setCurrent] = useState<{ examId: number | null; title: string }>({ examId: null, title: '' })
  const [result, setResult] = useState<GradeResult | null>(null)
  const [lastReview, setLastReview] = useState<ReviewItem[]>([])
  const [reviewOpen, setReviewOpen] = useState(false)

  const [qForm, setQForm] = useState(emptyQuestionForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formMessage, setFormMessage] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [genTitle, setGenTitle] = useState('')
  const [genSize, setGenSize] = useState('10')
  const [genSubjects, setGenSubjects] = useState<string[]>([])
  const [genLearners, setGenLearners] = useState<string[]>([])
  const [genMessage, setGenMessage] = useState('')
  const [newUser, setNewUser] = useState<{ name: string; email: string; password: string; role: Role }>({
    name: '', email: '', password: '', role: 'learner'
  })
  const [userMessage, setUserMessage] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadUrl, setUploadUrl] = useState('')

  const showToast = useCallback((msg: string, bad = false) => {
    setToastState({ msg, bad })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastState({ msg: '', bad: false }), bad ? 7000 : 3500)
  }, [])

  const run = useCallback(async (fn: () => Promise<void> | void) => {
    try { await fn() } catch (err) { showToast(err instanceof Error ? err.message : String(err), true) }
  }, [showToast])

  const apiUsers = useCallback(async (method: string, body?: unknown): Promise<{ users?: ManagedUser[] }> => {
    const { data } = await sb.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Please sign in again.')
    const res = await fetch('/api/users', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(payload.error || 'Request failed.')
    return payload
  }, [])

  const loadCatalog = useCallback(async () => {
    setCatalog(await rpc<CatalogItem[]>('get_catalog'))
  }, [])

  const loadDashboard = useCallback(async () => {
    if (!me) return
    const [rows] = await Promise.all([
      ok<Attempt[]>(sb.from('attempts').select('total,correct').eq('user_id', me.id)),
      loadCatalog()
    ])
    setAttempts(rows)
  }, [me, loadCatalog])

  const loadExamSets = useCallback(async () => {
    setExamSets(await rpc<ExamSummary[]>('get_my_exams'))
  }, [])

  const loadRevisionList = useCallback(async () => {
    setRevision(await rpc<Question[]>('get_my_revision'))
  }, [])

  const loadQuestions = useCallback(async () => {
    setQuestions(await fetchAll<Question>('questions', '*'))
  }, [])

  const loadManage = useCallback(async () => {
    const [qs, lr, ex, papers, atts] = await Promise.all([
      fetchAll<Question>('questions', '*'),
      ok<Profile[]>(sb.from('profiles').select('id,email,name').eq('role', 'learner')),
      ok<AdminExam[]>(sb.from('exams').select('id,title,size,subjects,created_at').order('created_at', { ascending: false })),
      ok<ExamPaperLink[]>(sb.from('exam_papers').select('exam_id,learner_id')),
      fetchAll<Attempt>('attempts', 'id,user_id,exam_id,total,correct,wrong,skipped')
    ])
    setQuestions(qs)
    setLearners(lr)
    setAdminExams(ex)
    setExamPapers(papers)
    setAllAttempts(atts)
  }, [])

  const loadUsersPage = useCallback(async () => {
    const [payload, atts] = await Promise.all([
      apiUsers('GET'),
      fetchAll<Attempt>('attempts', 'id,user_id,total,correct,created_at')
    ])
    setUsers(payload.users || [])
    setAllAttempts(atts)
  }, [apiUsers])

  const loadProfile = useCallback(async () => {
    const { data } = await sb.auth.getSession()
    const uid = data.session?.user.id
    if (!uid) { setMe(null); setLoading(false); return }
    const rows = await ok<Profile[]>(sb.from('profiles').select('id,email,name,role').eq('id', uid))
    const profile = rows[0]
    if (!profile) {
      await sb.auth.signOut()
      setMe(null)
      setLoginError('Your account is not set up yet. Please contact the administrator.')
      setLoading(false)
      return
    }
    setMe(profile)
    setLoading(false)
    setPage(profile.role === 'admin' ? 'manage' : 'dashboard')
  }, [])

  useEffect(() => {
    let active = true
    void run(loadProfile)
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (session) void run(loadProfile)
      else { setMe(null); setPage('dashboard'); setLoading(false) }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [loadProfile, run])

  useEffect(() => {
    if (!me || loading) return
    void run(async () => {
      if (page === 'dashboard') await loadDashboard()
      else if (page === 'subjects') await loadCatalog()
      else if (page === 'examsets') await loadExamSets()
      else if (page === 'revision') await loadRevisionList()
      else if (page === 'manage') await loadManage()
      else if (page === 'learners') await loadUsersPage()
    })
  }, [me, loading, page, loadDashboard, loadCatalog, loadExamSets, loadRevisionList, loadManage, loadUsersPage, run])

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    if (!email || !password) { setLoginError('Enter your email and password.'); return }
    setBusy(true)
    const { error } = await sb.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) {
      setLoginError(/invalid login/i.test(error.message) ? 'Email or password is incorrect.' : error.message)
    }
  }

  const logout = () => run(async () => {
    await sb.auth.signOut()
    setMe(null)
    setPage('dashboard')
    setEmail('')
    setPassword('')
  })

  const navigate = (next: string) => {
    setPage(next)
    setReviewOpen(false)
  }

  const beginExam = (items: Question[], title: string, examId: number | null) => {
    if (!items.length) { showToast('No questions found.', true); return }
    setExam(items)
    setAnswers({})
    setIndex(0)
    setCurrent({ examId, title })
    setResult(null)
    setReviewOpen(false)
    setPage('exam')
  }

  const startPractice = (subject: string, topic: string | null) => run(async () => {
    const items = await rpc<Question[]>('get_practice_questions', { p_subject: subject, p_topic: topic })
    beginExam(items, topic || subject, null)
  })

  const startAssignedExam = async (examId: number, title: string) => run(async () => {
    const paper = await rpc<Question[]>('get_my_paper', { p_exam_id: examId })
    beginExam(paper, title, examId)
  })

  const finishExam = () => run(async () => {
    setBusy(true)
    try {
      const grade = current.examId !== null
        ? await rpc<GradeResult>('submit_exam', { p_exam_id: current.examId, p_answers: answers })
        : await rpc<GradeResult>('submit_practice', { p_qids: exam.map(q => q.id), p_answers: answers })
      setResult(grade)
      setLastReview(grade.review)
      setReviewOpen(false)
      setPage('result')
      await loadDashboard()
    } finally { setBusy(false) }
  })

  const reviewAttempt = (attemptId: number) => run(async () => {
    const rows = await ok<Array<{ details: ReviewItem[] }>>(sb.from('attempt_details').select('details').eq('attempt_id', attemptId))
    if (!rows.length) { showToast('Details for this attempt are not available.', true); return }
    const details = rows[0].details
    const correct = details.filter(x => x.chosen === x.answer).length
    const skipped = details.filter(x => x.chosen === null).length
    setLastReview(details)
    setResult({ review: details, total: details.length, correct, skipped, wrong: details.length - correct - skipped })
    setReviewOpen(true)
    setPage('result')
  })

  const saveQuestion = (e: React.FormEvent) => run(async () => {
    e.preventDefault()
    const payload = {
      subject: qForm.subject.trim(),
      topic: qForm.topic.trim(),
      qtext: qForm.qtext.trim(),
      options: qForm.options.map(o => o.trim()),
      answer: Number(qForm.answer),
      difficulty: qForm.difficulty,
      explanation: qForm.explanation.trim()
    }
    if (!payload.subject || !payload.topic || !payload.qtext || payload.options.some(o => !o)) {
      setFormMessage('Please complete the subject, topic, question and all four options.')
      return
    }
    setBusy(true)
    try {
      if (editingId !== null) await ok(sb.from('questions').update(payload).eq('id', editingId))
      else await ok(sb.from('questions').insert(payload))
      setQForm(emptyQuestionForm)
      setEditingId(null)
      setFormMessage(editingId !== null ? 'Question updated.' : 'Question added.')
      await loadQuestions()
    } finally { setBusy(false) }
  })

  const editQuestion = (q: Question) => {
    setEditingId(q.id)
    setQForm({
      subject: q.subject,
      topic: q.topic,
      qtext: q.qtext,
      options: [...q.options],
      answer: String(q.answer),
      difficulty: q.difficulty || 'Intermediate',
      explanation: q.explanation || ''
    })
    setFormMessage('Editing question. Make your changes and save.')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setQForm(emptyQuestionForm)
    setFormMessage('Editing cancelled.')
  }

  const deleteQuestion = (id: number) => run(async () => {
    if (!confirm('Delete this question? This cannot be undone unless you have a CSV export.')) return
    await ok(sb.from('questions').delete().eq('id', id))
    if (editingId === id) cancelEdit()
    await loadQuestions()
  })

  const downloadTemplate = () => {
    const csv = 'Subject,Topic,Question,A,B,C,D,Correct,Difficulty,Explanation\n"Indian Constitution","Fundamental Rights","Which Article guarantees equality before the law?","Article 12","Article 14","Article 19","Article 21","B","Basic","Article 14 guarantees equality before the law."\n'
    downloadFile('PSC_MASTER_question_template.csv', csv, 'text/csv;charset=utf-8')
  }

  const exportCSV = () => {
    const rows = [
      ['Subject', 'Topic', 'Question', 'A', 'B', 'C', 'D', 'Correct', 'Difficulty', 'Explanation'],
      ...questions.map(q => [q.subject, q.topic, q.qtext, ...q.options, 'ABCD'[q.answer], q.difficulty || '', q.explanation || ''])
    ]
    const csv = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\n')
    downloadFile('psc-master-questions.csv', csv, 'text/csv;charset=utf-8')
  }

  const importQuestions = () => run(async () => {
    if (!importFile) { setImportMessage('Please choose a CSV file first.'); return }
    const rows = parseCSV((await importFile.text()).replace(/^\uFEFF/, ''))
    if (rows.length < 2) throw new Error('The file has no question rows.')
    const headers = rows[0].map(h => h.trim().toLowerCase())
    const missing = ['subject', 'topic', 'question', 'a', 'b', 'c', 'd', 'correct'].filter(h => !headers.includes(h))
    if (missing.length) throw new Error('Missing columns: ' + missing.join(', '))
    const col = (name: string) => headers.indexOf(name)
    const added: Array<Record<string, unknown>> = []
    rows.slice(1).forEach((r, i) => {
      const get = (name: string) => String(r[col(name)] ?? '').trim()
      const answer = 'ABCD'.indexOf(get('correct').toUpperCase())
      if (!get('subject') || !get('topic') || !get('question') || ['a', 'b', 'c', 'd'].some(k => !get(k)) || answer < 0) {
        throw new Error('Please check row ' + (i + 2) + ': all core fields are required and Correct must be A, B, C or D.')
      }
      added.push({
        subject: get('subject'), topic: get('topic'), qtext: get('question'),
        options: ['a', 'b', 'c', 'd'].map(get), answer,
        difficulty: get('difficulty') || 'Intermediate', explanation: get('explanation')
      })
    })
    setImportMessage('Importing ' + added.length + ' questions…')
    for (let i = 0; i < added.length; i += 200) {
      await ok(sb.from('questions').insert(added.slice(i, i + 200)))
    }
    setImportFile(null)
    await loadQuestions()
    setImportMessage(added.length + ' questions imported successfully.')
  })

  const subjects = useMemo(() => [...new Set(questions.map(q => q.subject))], [questions])

  const updateSubjects = (subject: string) => {
    setGenSubjects(prev => prev.includes(subject) ? prev.filter(s => s !== subject) : [...prev, subject])
  }

  const updateLearners = (id: string) => {
    setGenLearners(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  const generateExam = () => run(async () => {
    const size = Number(genSize)
    if (!genSubjects.length) { setGenMessage('Select at least one subject.'); return }
    if (!genLearners.length) { setGenMessage('Select at least one learner.'); return }
    if (!Number.isInteger(size) || size < 1) { setGenMessage('Enter a whole number of questions (1 or more).'); return }
    const pool = questions.filter(q => genSubjects.includes(q.subject))
    if (size > pool.length) { setGenMessage('Only ' + pool.length + ' questions are available in the selected subjects.'); return }
    const title = genTitle.trim() || ('Exam ' + new Date().toLocaleDateString())
    setBusy(true)
    try {
      const created = await ok<Array<{ id: number }>>(sb.from('exams').insert({ title, size, subjects: genSubjects }).select('id'))
      const examId = created[0].id
      try {
        await ok(sb.from('exam_papers').insert(genLearners.map(id => ({
          exam_id: examId,
          learner_id: id,
          items: shuffle(pool).slice(0, size).map(q => {
            const perm = shuffle([0, 1, 2, 3])
            return {
              id: q.id, subject: q.subject, topic: q.topic, qtext: q.qtext,
              difficulty: q.difficulty || 'Intermediate', explanation: q.explanation || '',
              options: perm.map(i => q.options[i]), answer: perm.indexOf(q.answer)
            }
          })
        }))))
      } catch (err) {
        await sb.from('exams').delete().eq('id', examId)
        throw err
      }
      setGenTitle('')
      setGenMessage('Exam created: a separate ' + size + '-question paper for each of ' + genLearners.length + ' learners.')
      await loadManage()
    } finally { setBusy(false) }
  })

  const deleteExam = (examId: number, title: string) => run(async () => {
    if (!confirm('Delete the examination "' + title + '" and all learners\' papers for it? Recorded scores stay.')) return
    await ok(sb.from('exams').delete().eq('id', examId))
    await loadManage()
  })

  const createUser = (e: React.FormEvent) => run(async () => {
    e.preventDefault()
    setUserMessage('Creating user…')
    try {
      await apiUsers('POST', newUser)
      setNewUser({ name: '', email: '', password: '', role: 'learner' })
      setUserMessage('User created.')
      await loadUsersPage()
    } catch (err) { setUserMessage(err instanceof Error ? err.message : String(err)) }
  })

  const changeUserRole = (id: string, role: Role) => run(async () => {
    await apiUsers('PATCH', { id, role })
    showToast('Role updated.')
    await loadUsersPage()
  })

  const deleteUser = (id: string, userEmail: string) => run(async () => {
    if (!confirm('Delete ' + userEmail + '? This cannot be undone.')) return
    await apiUsers('DELETE', { id })
    showToast('User deleted.')
    await loadUsersPage()
  })

  const uploadObject = () => run(async () => {
    if (!uploadFile) { setUploadUrl('Choose a file first.'); return }
    const { data } = await sb.auth.getSession()
    const token = data.session?.access_token
    const form = new FormData()
    form.append('file', uploadFile)
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(payload.error || 'Upload failed.')
    setUploadUrl(payload.url || '')
    setUploadFile(null)
  })

  const currentQuestion = exam[index]
  const learnerSubjects = [...new Set(catalog.map(c => c.subject))]

  if (loading) return <div className="login-wrap"><div className="login-card"><h1>PSC MASTER</h1><p className="muted">Loading…</p></div></div>

  if (!me) {
    return (
      <>
        <div className="login-wrap">
          <div className="login-shell">
            <section className="login-card" aria-labelledby="login-title">
              <div className="brand-mark" aria-hidden="true">P</div>
              <p className="eyebrow">KERALA PSC PRACTICE</p>
              <h1 id="login-title">PSC MASTER</h1>
              <p className="muted">Your private practice room for focused Kerala PSC preparation.</p>
              <form onSubmit={login} className="login-form">
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="username" required />
                <label htmlFor="password">Password</label>
                <input id="password" name="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" required />
                <button id="loginBtn" className="primary full" type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
              </form>
              <p id="loginError" className="error" aria-live="polite">{loginError}</p>
              <p className="tiny muted">Need an account? Ask your administrator.</p>
            </section>
            <SiteFooter />
          </div>
        </div>
        {toastState.msg && <div className={'toast' + (toastState.bad ? ' bad' : '')} role="status">{toastState.msg}</div>}
      </>
    )
  }

  const admin = me.role === 'admin'

  const navButton = (target: string, label: string, icon: string) => (
    <button className={'nav-item' + (page === target ? ' active' : '')} data-page={target} onClick={() => navigate(target)} aria-current={page === target ? 'page' : undefined}>
      <span className="nav-icon" aria-hidden="true">{icon}</span>
      <span className="nav-label">{label}</span>
    </button>
  )

  const renderDashboard = () => {
    const attempted = attempts.reduce((a, x) => a + x.total, 0)
    const correct = attempts.reduce((a, x) => a + x.correct, 0)
    return (
      <section id="dashboardPage" className="page">
        <div className="welcome"><div><p className="eyebrow light">YOUR PREPARATION SPACE</p><h1>Keep learning.<br />Keep improving.</h1><p>Choose a topic, practise MCQs and track your progress.</p></div><div className="welcome-symbol">✦</div></div>
        <div className="stats">
          <article className="stat"><span>Tests completed</span><strong>{attempts.length}</strong></article>
          <article className="stat"><span>Questions attempted</span><strong>{attempted}</strong></article>
          <article className="stat"><span>Correct answers</span><strong>{correct}</strong></article>
          <article className="stat"><span>Accuracy</span><strong>{attempted ? pct(correct, attempted) + '%' : '—'}</strong></article>
        </div>
        <div className="section-heading"><div><p className="eyebrow">GET STARTED</p><h3>Available subjects</h3></div><button className="text-button" onClick={() => navigate('subjects')}>View all →</button></div>
        <div className="subject-grid">
          {learnerSubjects.map(subject => (
            <button key={subject} className="subject-tile" onClick={() => void startPractice(subject, null)}>
              <b>{subject}</b><span>{catalog.filter(c => c.subject === subject).reduce((a, c) => a + c.n, 0)} questions · Practise →</span>
            </button>
          ))}
          {!learnerSubjects.length && <p className="muted">No questions added yet.</p>}
        </div>
      </section>
    )
  }

  const renderSubjects = () => (
    <section id="subjectsPage" className="page">
      <div className="section-heading"><div><p className="eyebrow">QUESTION BANK</p><h3>Choose a subject</h3><p className="muted">Select a topic to start a practice test.</p></div></div>
      <div className="subject-list">
        {learnerSubjects.map(subject => (
          <div key={subject} className="subject-block">
            <h3>{subject}</h3>
            {catalog.filter(c => c.subject === subject).map(item => (
              <button key={item.topic} className="topic-row" onClick={() => void startPractice(item.subject, item.topic)}>
                <span>{item.topic}</span><small>{item.n} questions　→</small>
              </button>
            ))}
          </div>
        ))}
        {!learnerSubjects.length && <p className="muted">The question bank is empty. Ask the admin to add questions.</p>}
      </div>
    </section>
  )

  const renderExamSets = () => (
    <section id="examsetsPage" className="page">
      <div className="section-heading"><div><p className="eyebrow">ASSIGNED PAPERS</p><h3>Your examinations</h3><p className="muted">Papers created for you by the administrator. Each paper can be completed once.</p></div></div>
      <div className="question-list">
        {examSets.map(s => (
          <article key={s.id} className="admin-q">
            <div className="admin-q-content">
              <b>{s.title}</b><br />
              <small>{fmtDate(s.created_at)} · {Number(s.size)} questions · {(s.subjects || []).join(', ')}</small>
              <p className="admin-q-answer">
                {s.attempt_id
                  ? 'Completed · Score: ' + s.correct + '/' + s.total + ' (' + pct(s.correct, s.total) + '%)'
                  : 'Not taken yet'}
              </p>
            </div>
            <div className="admin-q-actions">
              {s.attempt_id
                ? <button className="secondary small-btn" onClick={() => reviewAttempt(s.attempt_id!)}>Review</button>
                : <button className="primary small-btn" onClick={() => void startAssignedExam(s.id, s.title)}>Start</button>}
            </div>
          </article>
        ))}
        {!examSets.length && <p className="muted">No examinations have been assigned to you yet.</p>}
      </div>
    </section>
  )

  const renderRevision = () => (
    <section id="revisionPage" className="page">
      <div className="section-heading"><div><p className="eyebrow">LEARN FROM MISTAKES</p><h3>Your revision list</h3><p className="muted">Questions you answered incorrectly are collected here.</p></div></div>
      <div>
        {revision.map(q => (
          <article key={q.id} className="revision-q">
            <b>{q.qtext}</b>
            <p><small>{q.subject} · {q.topic}</small></p>
            <p>Correct answer: {'ABCD'[q.answer]}. {q.options[q.answer]}</p>
            <small>{q.explanation || ''}</small>
          </article>
        ))}
        {!revision.length && <p className="muted">No incorrect answers saved yet. Complete a test to build your revision list.</p>}
      </div>
    </section>
  )

  const renderExam = () => {
    if (!currentQuestion) return null
    return (
      <section id="examPage" className="page">
        <div className="exam-head"><div><p className="eyebrow">PRACTICE TEST</p><h3>{current.title}</h3></div><span className="pill">{index + 1} / {exam.length}</span></div>
        <div className="progress-track"><div id="progressBar" style={{ width: ((index + 1) / exam.length) * 100 + '%' }} /></div>
        <article className="exam-card">
          <div className="question-meta"><span>QUESTION {index + 1}</span><span className="pill">{currentQuestion.difficulty || ''}</span></div>
          <h2>{currentQuestion.qtext}</h2>
          <div className="options">
            {currentQuestion.options.map((option, i) => (
              <button key={i} className={'option' + (answers[currentQuestion.id] === i ? ' selected' : '')} onClick={() => setAnswers(prev => ({ ...prev, [currentQuestion.id]: i }))}>
                <span className="letter">{'ABCD'[i]}</span>{option}
              </button>
            ))}
          </div>
          <div className="exam-actions">
            <button className="secondary" disabled={index === 0} onClick={() => setIndex(i => i - 1)}>← Previous</button>
            <button className="primary" onClick={() => {
              if (index < exam.length - 1) setIndex(i => i + 1)
              else if (confirm('Finish and submit this test?')) void finishExam()
            }}>{index === exam.length - 1 ? 'Finish questions' : 'Next →'}</button>
          </div>
        </article>
        <div className="exam-footer"><span className="muted">{Object.keys(answers).length} of {exam.length} answered</span><button className="text-button danger-text" onClick={() => { if (confirm('Submit this test now?')) void finishExam() }}>Submit test</button></div>
      </section>
    )
  }

  const renderResult = () => {
    const g = result
    if (!g) return null
    return (
      <section id="resultPage" className="page">
        <div className="result-card">
          <p className="eyebrow">TEST COMPLETED</p><h2>Your result</h2>
          <div className="score-ring"><strong>{pct(g.correct, g.total)}%</strong><span>accuracy</span></div>
          <div className="result-stats">
            <div><strong>{g.correct}</strong><span>Correct</span></div>
            <div><strong>{g.wrong}</strong><span>Wrong</span></div>
            <div><strong>{g.skipped}</strong><span>Skipped</span></div>
            <div><strong>{g.total}</strong><span>Total</span></div>
          </div>
          <button className="primary" onClick={() => setReviewOpen(v => !v)}>Review answers</button>
          <button className="secondary" onClick={() => navigate('dashboard')}>Dashboard</button>
        </div>
        <div className={'answer-review' + (reviewOpen ? '' : ' hidden')}>
          {lastReview.map((q, i) => {
            const good = q.chosen === q.answer
            return (
              <article key={q.id} className="answer-item">
                <b>{i + 1}. {q.qtext}</b>
                <p className={good ? 'correct' : q.chosen === null ? '' : 'wrong'}>
                  {q.chosen === null ? 'Not attempted' : (good ? 'Correct · ' : 'Incorrect · ') + 'Your answer: ' + q.options[q.chosen]}
                </p>
                <p><b>Correct answer:</b> {'ABCD'[q.answer]}. {q.options[q.answer]}</p>
                <p>{q.explanation || 'No explanation added.'}</p>
              </article>
            )
          })}
        </div>
      </section>
    )
  }

  const renderManage = () => (
    <section id="managePage" className="page">
      <div className="section-heading"><div><p className="eyebrow">ADMIN AREA</p><h3>Manage question bank</h3><p className="muted">Only the administrator can add and change questions.</p></div></div>
      <form className="form-card" onSubmit={saveQuestion}>
        <div className="section-heading form-title"><h3>{editingId !== null ? 'Edit question' : 'Add a question'}</h3></div>
        <div className="form-grid">
          <label>Subject<input value={qForm.subject} onChange={e => setQForm({ ...qForm, subject: e.target.value })} required placeholder="e.g. Indian Constitution" /></label>
          <label>Topic<input value={qForm.topic} onChange={e => setQForm({ ...qForm, topic: e.target.value })} required placeholder="e.g. Fundamental Rights" /></label>
        </div>
        <label>Question<textarea value={qForm.qtext} onChange={e => setQForm({ ...qForm, qtext: e.target.value })} required rows={3} placeholder="Enter the question" /></label>
        <div className="form-grid">
          {qForm.options.map((option, i) => (
            <label key={i}>Option {'ABCD'[i]}<input value={option} onChange={e => {
              const options = [...qForm.options]
              options[i] = e.target.value
              setQForm({ ...qForm, options })
            }} required /></label>
          ))}
        </div>
        <div className="form-grid">
          <label>Correct option<select value={qForm.answer} onChange={e => setQForm({ ...qForm, answer: e.target.value })}><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label>
          <label>Difficulty<select value={qForm.difficulty} onChange={e => setQForm({ ...qForm, difficulty: e.target.value })}><option>Basic</option><option>Intermediate</option><option>Advanced</option></select></label>
        </div>
        <label>Explanation<textarea value={qForm.explanation} onChange={e => setQForm({ ...qForm, explanation: e.target.value })} rows={2} placeholder="Why is this the correct answer?" /></label>
        <div className="form-actions">
          <button className="primary" type="submit" disabled={busy}>{editingId !== null ? 'Save changes' : 'Add question'}</button>
          {editingId !== null && <button className="secondary" type="button" onClick={cancelEdit}>Cancel editing</button>}
          <span className="success">{formMessage}</span>
        </div>
      </form>

      <div className="section-heading"><div><h3>Bulk import questions</h3><p className="muted">Upload one CSV file to add many questions at once.</p></div><button className="secondary" type="button" onClick={downloadTemplate}>Download CSV template</button></div>
      <div className="form-card import-card">
        <label>Choose question file (CSV)<input type="file" accept=".csv,text/csv" onChange={e => setImportFile(e.target.files?.[0] || null)} /></label>
        <p className="muted tiny">Required columns: Subject, Topic, Question, A, B, C, D, Correct. Optional: Difficulty, Explanation.</p>
        <button className="primary" type="button" onClick={() => void importQuestions()}>Import questions</button>
        <span className="success">{importMessage}</span>
      </div>

      <div className="section-heading"><div><h3>Saved questions</h3><p className="muted tiny">{questions.length} questions in your bank</p></div><button className="secondary" onClick={exportCSV}>Export CSV</button></div>
      <div className="question-list">
        {questions.map(q => (
          <article key={q.id} className="admin-q">
            <div className="admin-q-content"><b>{q.qtext}</b><br /><small>{q.subject} · {q.topic} · {q.difficulty || 'Intermediate'}</small><p className="admin-q-answer">Correct answer: {'ABCD'[q.answer]}. {q.options[q.answer]}</p></div>
            <div className="admin-q-actions">
              <button className="secondary small-btn" onClick={() => editQuestion(q)}>Edit</button>
              <button className="text-button danger-text small-btn" onClick={() => void deleteQuestion(q.id)}>Delete</button>
            </div>
          </article>
        ))}
        {!questions.length && <p className="muted">No questions yet.</p>}
      </div>

      <div className="section-heading"><div><h3>Examination generator</h3><p className="muted">Creates a separate paper for each selected learner.</p></div></div>
      <div className="form-card gen-card">
        <div className="form-grid">
          <label>Exam title<input value={genTitle} onChange={e => setGenTitle(e.target.value)} placeholder="e.g. Weekly test 1" /></label>
          <label>Questions per paper<input type="number" min="1" step="1" value={genSize} onChange={e => setGenSize(e.target.value)} /></label>
        </div>
        <div><b className="tiny">Subjects to include</b><div className="check-grid">
          {subjects.map(subject => (
            <label key={subject} className="check-item"><input type="checkbox" checked={genSubjects.includes(subject)} onChange={() => updateSubjects(subject)} /><span>{subject} ({questions.filter(q => q.subject === subject).length})</span></label>
          ))}
        </div></div>
        <div><b className="tiny">Learners who get a paper</b><div className="check-grid">
          {learners.map(l => (
            <label key={l.id} className="check-item"><input type="checkbox" checked={genLearners.includes(l.id)} onChange={() => updateLearners(l.id)} /><span>{l.name || l.email}</span></label>
          ))}
        </div></div>
        <div className="form-actions"><button className="primary" type="button" onClick={() => void generateExam()} disabled={busy}>Generate exam for all learners</button><span className="success">{genMessage}</span></div>
      </div>

      <div className="section-heading"><div><h3>Generated examinations</h3><p className="muted tiny">{adminExams.length} examinations</p></div></div>
      <div className="question-list">
        {adminExams.map(s => {
          const assigned = examPapers.filter(p => p.exam_id === s.id).map(p => p.learner_id)
          const done = assigned.filter(id => allAttempts.some(a => a.exam_id === s.id && a.user_id === id)).length
          return (
            <article key={s.id} className="admin-q">
              <div className="admin-q-content">
                <b>{s.title}</b><br /><small>{fmtDate(s.created_at)} · {Number(s.size)} questions · {(s.subjects || []).join(', ')}</small>
                <p className="admin-q-answer">{done} of {assigned.length} learners completed</p>
                <details><summary className="tiny">View results</summary>
                  <table className="result-table"><thead><tr><th>Learner</th><th>Score</th><th>Wrong</th><th>Skipped</th></tr></thead><tbody>
                    {assigned.map(id => {
                      const r = allAttempts.find(a => a.exam_id === s.id && a.user_id === id)
                      const name = learners.find(l => l.id === id)
                      return <tr key={id}><td>{name ? name.name || name.email : '(removed learner)'}</td><td>{r ? r.correct + '/' + r.total + ' (' + pct(r.correct, r.total) + '%)' : 'Not taken'}</td><td>{r ? r.wrong : '—'}</td><td>{r ? r.skipped : '—'}</td></tr>
                    })}
                  </tbody></table>
                </details>
              </div>
              <div className="admin-q-actions"><button className="text-button danger-text small-btn" onClick={() => void deleteExam(s.id, s.title)}>Delete</button></div>
            </article>
          )
        })}
        {!adminExams.length && <p className="muted">No examinations generated yet.</p>}
      </div>

      <div className="section-heading"><div><h3>Object storage</h3><p className="muted">Upload a file to Vercel Blob and copy its public URL.</p></div></div>
      <div className="form-card import-card">
        <label>File<input type="file" onChange={e => setUploadFile(e.target.files?.[0] || null)} /></label>
        <div className="form-actions"><button className="primary" type="button" onClick={() => void uploadObject()}>Upload</button><span className="success">{uploadUrl}</span></div>
      </div>
      <p className="note">Your questions and exams are stored online. For a safety copy, use <b>Export CSV</b> now and then.</p>
    </section>
  )

  const renderUsers = () => (
    <section id="learnersPage" className="page">
      <div className="section-heading"><div><p className="eyebrow">ADMIN AREA</p><h3>Users &amp; admins</h3><p className="muted">Create accounts and change roles. Individual answers are never shown here.</p></div></div>
      <div className="form-card">
        <div className="section-heading form-title"><h3>Add a user</h3></div>
        <form className="form-grid" onSubmit={createUser}>
          <label>Name<input value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} placeholder="Full name" /></label>
          <label>Email<input type="email" required value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} placeholder="user@example.com" /></label>
          <label>Password<input type="password" required minLength={6} value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} placeholder="At least 6 characters" /></label>
          <label>Role<select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value as Role })}><option value="learner">Learner</option><option value="admin">Administrator</option></select></label>
          <div className="form-actions"><button className="primary" type="submit">Create user</button><span className="success">{userMessage}</span></div>
        </form>
      </div>
      <div className="section-heading"><div><h3>All users</h3><p className="muted">Scores and completion only, never individual answers.</p></div></div>
      <div className="question-list">
        {users.map(u => {
          const a = allAttempts.filter(x => x.user_id === u.id)
          const total = a.reduce((s, x) => s + x.total, 0)
          const correct = a.reduce((s, x) => s + x.correct, 0)
          const last = a.map(x => x.created_at).sort().pop()
          return (
            <article key={u.id} className="admin-q">
              <div className="admin-q-content">
                <b>{u.name || u.email}</b><br /><small>{u.email}</small>
                <p className="admin-q-answer"><span className="pill">{u.role === 'admin' ? 'Administrator' : 'Learner'}</span> · {a.length} tests · {total} questions attempted · accuracy {total ? pct(correct, total) + '%' : '—'}{last ? ' · last active ' + fmtDate(last) : ''}</p>
              </div>
              <div className="admin-q-actions">
                <select className="secondary small-btn" value={u.role} onChange={e => void changeUserRole(u.id, e.target.value as Role)}><option value="learner">Learner</option><option value="admin">Admin</option></select>
                <button className="text-button danger-text small-btn" onClick={() => void deleteUser(u.id, u.email)}>Delete</button>
              </div>
            </article>
          )
        })}
        {!users.length && <p className="muted">No users yet.</p>}
      </div>
      <p className="note">The first account remains the primary admin. At least one admin must always exist.</p>
    </section>
  )

  const renderPage = () => {
    if (page === 'dashboard') return renderDashboard()
    if (page === 'subjects') return renderSubjects()
    if (page === 'examsets') return renderExamSets()
    if (page === 'revision') return renderRevision()
    if (page === 'manage') return renderManage()
    if (page === 'learners') return renderUsers()
    if (page === 'exam') return renderExam()
    if (page === 'result') return renderResult()
    return renderDashboard()
  }

  return (
    <>
      <div className="app">
        <aside className="sidebar" aria-label="Main navigation">
          <div className="brand"><span className="brand-mark small" aria-hidden="true">P</span><div><b>PSC MASTER</b><small>Practice portal</small></div></div>
          <nav aria-label="Primary">
            {!admin && navButton('dashboard', 'Overview', '⌂')}
            {!admin && navButton('subjects', 'Subjects', '▤')}
            {!admin && navButton('examsets', 'Exams', '✎')}
            {!admin && navButton('revision', 'Revision', '↺')}
            {admin && navButton('manage', 'Questions', '☰')}
            {admin && navButton('learners', 'Users', '◌')}
          </nav>
          <div className="side-bottom"><span id="currentUser" className="side-user" title={me.email}>{me.name || me.email}</span><button id="logoutBtn" className="text-button" onClick={logout}>Log out</button></div>
        </aside>
        <div className="app-shell">
          <main className="main" id="main-content">
            <header className="topbar"><div><p className="eyebrow">KERALA PSC • PERSONAL PRACTICE</p><h1 id="pageTitle" className="page-title">{pageTitles[page] || page}</h1></div><span className="pill" id="rolePill">{admin ? 'Administrator' : 'Learner'}</span></header>
            {renderPage()}
          </main>
          <SiteFooter />
        </div>
      </div>
      {toastState.msg && <div className={'toast' + (toastState.bad ? ' bad' : '')} role="status" aria-live="polite">{toastState.msg}</div>}
    </>
  )
}
