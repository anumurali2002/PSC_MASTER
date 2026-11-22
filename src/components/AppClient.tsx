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
  dashboard: 'Dashboard',
  subjects: 'Available Exams',
  examsets: 'Exam History',
  revision: 'Revision',
  profile: 'My Profile',
  analytics: 'Performance Analytics',
  manage: 'Manage Questions',
  learners: 'Registered Students',
  exam: 'Practice Test',
  result: 'Test Result'
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
  const [authMode, setAuthMode] = useState<'login'|'signup'|'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginInfo, setLoginInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState('dashboard')
  const [toastState, setToastState] = useState({ msg: '', bad: false })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [myAttempts, setMyAttempts] = useState<Attempt[]>([])
  const [selectedAttempt, setSelectedAttempt] = useState<any | null>(null)
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
    const [rows, hist] = await Promise.all([
      ok<Attempt[]>(sb.from('attempts').select('id,user_id,exam_id,exam_title,kind,total,correct,wrong,skipped,created_at').eq('user_id', me.id).order('created_at',{ascending:false})),
      loadCatalog()
    ])
    setAttempts(rows)
    setMyAttempts(rows)
  }, [me, loadCatalog])

  const loadExamSets = useCallback(async () => {
    const [sets, hist] = await Promise.all([
      rpc<ExamSummary[]>('get_my_exams'),
      ok<Attempt[]>(sb.from('attempts').select('id,user_id,exam_id,exam_title,kind,total,correct,wrong,skipped,created_at').eq('user_id', me!.id).order('created_at',{ascending:false}))
    ])
    setExamSets(sets)
    setMyAttempts(hist)
  }, [me])

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
    const rows = await ok<Profile[]>(sb.from('profiles').select('id,email,name,username,role,created_at,disabled').eq('id', uid))
    const profile = rows[0] as Profile | undefined
    if (!profile) {
      await sb.auth.signOut()
      setMe(null)
      setLoginError('Your account is not set up yet. Please contact the administrator.')
      setLoading(false)
      return
    }
    if (profile.disabled) {
      await sb.auth.signOut()
      setMe(null)
      setLoginError('Your account has been disabled. Contact the administrator.')
      setLoading(false)
      return
    }
    setMe(profile)
    setLoading(false)
    setPage(p => (p === 'dashboard' || p === 'manage') ? (profile.role === 'admin' ? 'manage' : 'dashboard') : p)
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
    setLoginError(''); setLoginInfo('')
    if (!email || !password) { setLoginError('Enter your email and password.'); return }
    setBusy(true)
    const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setBusy(false)
    if (error) setLoginError(/invalid login/i.test(error.message) ? 'Email or password is incorrect.' : error.message)
  }

  const signup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(''); setLoginInfo('')
    const name = fullName.trim(); const uname = username.trim().toLowerCase(); const em = email.trim().toLowerCase()
    if (!name || !uname || !em || !password || !confirmPassword) { setLoginError('Complete all registration fields.'); return }
    if (!/^[a-z0-9_.-]{3,30}$/.test(uname)) { setLoginError('Username must be 3-30 chars: letters, numbers, _, ., -'); return }
    if (!/^\S+@\S+\.\S+$/.test(em)) { setLoginError('Enter a valid email address.'); return }
    if (password.length < 6) { setLoginError('Password must be at least 6 characters.'); return }
    if (password !== confirmPassword) { setLoginError('Passwords do not match.'); return }
    setBusy(true)
    try {
      // username uniqueness check in profiles
      const { data: existing } = await sb.from('profiles').select('id').ilike('username', uname).maybeSingle()
      if (existing) { setLoginError('Username is already taken.'); return }
      const { data, error } = await sb.auth.signUp({ email: em, password, options: { data: { name, username: uname } } })
      if (error) { setLoginError(error.message); return }
      if (data.user) {
        await sb.from('profiles').upsert({ id: data.user.id, email: em, name, username: uname, role: 'learner' }, { onConflict: 'id' })
      }
      if (data.session) {
        setLoginInfo('Account created. Redirecting to dashboard...')
        setPage('dashboard')
      } else {
        setLoginInfo('Registration successful. Check your email to confirm, then sign in.')
        setAuthMode('login')
      }
    } finally { setBusy(false) }
  }

  const forgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(''); setLoginInfo('')
    const em = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(em)) { setLoginError('Enter your email address.'); return }
    setBusy(true)
    const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: window.location.origin })
    setBusy(false)
    if (error) setLoginError(error.message)
    else setLoginInfo('If the account exists, a password reset email has been sent.')
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
    let detail: any = null
    try { detail = await rpc<any>('get_my_attempt_detail', { p_attempt_id: attemptId }) } catch {}
    if (!detail) {
      const rows = await ok<Array<{ details: ReviewItem[] }>>(sb.from('attempt_details').select('details').eq('attempt_id', attemptId))
      if (!rows.length) { showToast('Details for this attempt are not available.', true); return }
      detail = { review: rows[0].details }
    }
    const details = (detail.review || detail.details || []) as ReviewItem[]
    const correct = Number(detail.correct ?? details.filter(x => x.chosen === x.answer).length)
    const skipped = Number(detail.skipped ?? details.filter(x => x.chosen === null).length)
    const total = Number(detail.total ?? details.length)
    setSelectedAttempt(detail)
    setLastReview(details)
    setResult({ review: details, total, correct, skipped, wrong: Number(detail.wrong ?? total - correct - skipped) })
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
    const title = genTitle.trim()
    const size = Number(genSize)
    const selectedSubjects = [...new Set(genSubjects)]
    const selectedLearners = [...new Set(genLearners)]
    setGenMessage('')
    if (!title) { setGenMessage('Enter an exam title before generating.'); return }
    if (!Number.isInteger(size) || size < 1) { setGenMessage('Enter a whole number of questions (1 or more).'); return }
    if (!selectedSubjects.length) { setGenMessage('Select at least one subject/topic.'); return }
    if (!selectedLearners.length) { setGenMessage('Select at least one learner.'); return }

    setBusy(true)
    try {
      const pool: Question[] = []
      for (let i = 0; i < selectedSubjects.length; i += 20) {
        const chunk = selectedSubjects.slice(i, i + 20)
        let from = 0
        for (;;) {
          const { data, error } = await sb.from('questions').select('*').in('subject', chunk).order('id', { ascending: true }).range(from, from + 999)
          if (error) throw new Error(error.message)
          const rows = (data ?? []) as Question[]
          pool.push(...rows)
          if (rows.length < 1000) break
          from += 1000
        }
      }
      const uniquePool = Array.from(new Map(pool.map(q => [q.id, q])).values())
      if (size > uniquePool.length) {
        setGenMessage('Only ' + uniquePool.length + ' questions are available in the selected subjects/topics. Reduce the question count or select more subjects.')
        return
      }

      const created = await ok<Array<{ id: number }>>(sb.from('exams').insert({ title, size, subjects: selectedSubjects }).select('id'))
      const examId = created[0].id
      try {
        const papers = selectedLearners.map(id => ({
          exam_id: examId,
          learner_id: id,
          items: shuffle(uniquePool).slice(0, size).map(q => {
            const perm = shuffle([0, 1, 2, 3])
            return {
              id: q.id, subject: q.subject, topic: q.topic, qtext: q.qtext,
              difficulty: q.difficulty || 'Intermediate', explanation: q.explanation || '',
              options: perm.map(i => q.options[i]), answer: perm.indexOf(q.answer)
            }
          })
        }))
        for (let i = 0; i < papers.length; i += 100) {
          await ok(sb.from('exam_papers').insert(papers.slice(i, i + 100)))
        }
      } catch (err) {
        await sb.from('exams').delete().eq('id', examId)
        throw err
      }

      setGenTitle('')
      setGenSubjects([])
      setGenLearners([])
      setGenMessage('Exam "' + title + '" created: ' + size + ' questions from ' + selectedSubjects.length + ' subject(s), assigned to ' + selectedLearners.length + ' learner(s).')
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
              <p className="muted">{authMode==='signup' ? 'Create your student account.' : authMode==='forgot' ? 'Reset your password.' : 'Your private practice room for focused Kerala PSC preparation.'}</p>

              {authMode === 'login' && (
                <form onSubmit={login} className="login-form">
                  <label htmlFor="email">Email</label>
                  <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="username" required />
                  <label htmlFor="password">Password</label>
                  <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" required />
                  <button className="primary full" type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
                </form>
              )}

              {authMode === 'signup' && (
                <form onSubmit={signup} className="login-form">
                  <label htmlFor="fullName">Full Name</label>
                  <input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name" required />
                  <label htmlFor="username">Username <span className="muted">(optional)</span></label>
                  <input id="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="username (optional)" autoComplete="username" />
                  <label htmlFor="email">Email Address</label>
                  <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
                  <label htmlFor="password">Password</label>
                  <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" required minLength={6} />
                  <label htmlFor="confirmPassword">Confirm Password</label>
                  <input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm password" autoComplete="new-password" required minLength={6} />
                  <button className="primary full" type="submit" disabled={busy}>{busy ? 'Creating account...' : 'Register'}</button>
                </form>
              )}

              {authMode === 'forgot' && (
                <form onSubmit={forgotPassword} className="login-form">
                  <label htmlFor="email">Email Address</label>
                  <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
                  <button className="primary full" type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
                </form>
              )}

              <p id="loginError" className="error" aria-live="polite">{loginError}</p>
              {loginInfo && <p className="success" aria-live="polite">{loginInfo}</p>}
              <div className="auth-links tiny muted">
                {authMode !== 'login' && <button type="button" className="text-button" onClick={() => { setAuthMode('login'); setLoginError(''); setLoginInfo('') }}>Back to login</button>}
                {authMode === 'login' && <button type="button" className="text-button" onClick={() => { setAuthMode('signup'); setLoginError(''); setLoginInfo('') }}>Create account</button>}
                {authMode === 'login' && <button type="button" className="text-button" onClick={() => { setAuthMode('forgot'); setLoginError(''); setLoginInfo('') }}>Forgot password?</button>}
              </div>
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
        <div><b className="tiny">Subjects/topics to include</b><div className="check-grid">
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

  const statCards = (rows: Attempt[]) => {
    const total = rows.reduce((a,x)=>a+x.total,0), correct = rows.reduce((a,x)=>a+x.correct,0), wrong = rows.reduce((a,x)=>a+x.wrong,0)
    const acc = total ? Math.round(correct*100/total) : 0
    const avg = rows.length ? Math.round(rows.reduce((a,x)=>a + (x.total?x.correct*100/x.total:0),0)/rows.length) : 0
    const best = rows.length ? Math.max(...rows.map(x=>x.total?Math.round(x.correct*100/x.total):0)) : 0
    return {count:rows.length,total,correct,wrong,acc,avg,best}
  }

  const renderProfile = () => {
    const st = statCards(myAttempts)
    return (
      <section className="page">
        <div className="section-heading"><div><p className="eyebrow">STUDENT PROFILE</p><h3>{me!.name || me!.email}</h3><p className="muted">{me!.username ? '@' + me!.username + ' • ' : ''}{me!.email}</p></div></div>
        <div className="stats">
          <article className="stat"><span>Total Exams Attempted</span><strong>{st.count}</strong></article>
          <article className="stat"><span>Questions Answered</span><strong>{st.total}</strong></article>
          <article className="stat"><span>Correct Answers</span><strong>{st.correct}</strong></article>
          <article className="stat"><span>Wrong Answers</span><strong>{st.wrong}</strong></article>
          <article className="stat"><span>Overall Accuracy</span><strong>{st.acc}%</strong></article>
          <article className="stat"><span>Average Score</span><strong>{st.avg}%</strong></article>
          <article className="stat"><span>Best Score</span><strong>{st.best}%</strong></article>
          <article className="stat"><span>Account Created</span><strong style={{fontSize:16}}>{me!.created_at ? fmtDate(me!.created_at) : '—'}</strong></article>
        </div>
        <div className="form-card">
          <div className="section-heading form-title"><h3>Profile settings</h3></div>
          <form className="form-grid" onSubmit={(e)=>run(async()=>{e.preventDefault(); const uname=(username.trim()||'').toLowerCase(); await apiUsers('PATCH',{id:me!.id,name:fullName.trim()||me!.name,username:uname||null}); showToast('Profile updated.'); await loadProfile()})}>
            <label>Full Name<input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder={me!.name||''} /></label>
            <label>Username (optional)<input value={username} onChange={e=>setUsername(e.target.value)} placeholder={me!.username||'Optional'} /></label>
            <div className="form-actions"><button className="primary" type="submit">Save profile</button></div>
          </form>
          <form className="form-grid" onSubmit={(e)=>run(async()=>{e.preventDefault(); if(password.length<6){showToast('Password must be at least 6 characters.',true);return;} if(password!==confirmPassword){showToast('Passwords do not match.',true);return;} const {error}=await sb.auth.updateUser({password}); if(error) throw error; setPassword(''); setConfirmPassword(''); showToast('Password changed.')})}>
            <label>New Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={6} /></label>
            <label>Confirm Password<input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={6} /></label>
            <div className="form-actions"><button className="secondary" type="submit">Change password</button></div>
          </form>
        </div>
      </section>
    )
  }

  const renderAnalytics = () => {
    const rows = [...myAttempts].reverse()
    const max = 100
    const vals = rows.map(a=>a.total?Math.round(a.correct*100/a.total):0)
    const line = (v:number[], color:string) => {
      if(!v.length) return <p className="muted">No attempt data yet.</p>
      const w=600,h=180,p=20; const step = v.length>1 ? (w-p*2)/(v.length-1) : 0
      const pts = v.map((val,i)=> (p+i*step)+','+(h-p-(val/max)*(h-p*2))).join(' ')
      return <svg viewBox={'0 0 '+w+' '+h} className="chart-svg" role="img"><polyline fill="none" stroke={color} strokeWidth="3" points={pts} />{v.map((val,i)=><circle key={i} cx={p+i*step} cy={h-p-(val/max)*(h-p*2)} r="4" fill={color} />)}</svg>
    }
    const st = statCards(myAttempts)
    const subjectMap: Record<string,{total:number,correct:number}> = {}
    myAttempts.forEach(a=>{ const k = a.exam_title || (a.kind==='exam'?'Exam':'Practice'); subjectMap[k] ??= {total:0,correct:0}; subjectMap[k].total+=a.total; subjectMap[k].correct+=a.correct })
    const subjects = Object.entries(subjectMap).slice(0,6)
    return (
      <section className="page">
        <div className="section-heading"><div><p className="eyebrow">ANALYTICS</p><h3>Performance Analytics</h3></div></div>
        <div className="stats">
          <article className="stat"><span>Average Score</span><strong>{st.avg}%</strong></article>
          <article className="stat"><span>Best Score</span><strong>{st.best}%</strong></article>
          <article className="stat"><span>Accuracy</span><strong>{st.acc}%</strong></article>
          <article className="stat"><span>Attempts</span><strong>{st.count}</strong></article>
        </div>
        <div className="form-card"><h3>Exam Performance Trend</h3>{line(vals,'#176b55')}</div>
        <div className="form-card"><h3>Accuracy Trend</h3>{line(vals,'#1d6553')}</div>
        <div className="form-card"><h3>Correct vs Wrong</h3>
          <div className="bar-wrap">
            <div className="bar-row"><span>Correct</span><div className="bar-bg"><div className="bar-fill good" style={{width:(st.total?st.correct*100/st.total:0)+'%'}} /></div><b>{st.correct}</b></div>
            <div className="bar-row"><span>Wrong</span><div className="bar-bg"><div className="bar-fill bad" style={{width:(st.total?st.wrong*100/st.total:0)+'%'}} /></div><b>{st.wrong}</b></div>
          </div>
        </div>
        <div className="form-card"><h3>Recent/Subject Performance</h3>
          {subjects.length ? subjects.map(([name,vv])=>{const p=vv.total?Math.round(vv.correct*100/vv.total):0; return <div key={name} className="bar-row"><span>{name}</span><div className="bar-bg"><div className="bar-fill good" style={{width:p+'%'}} /></div><b>{p}%</b></div>}) : <p className="muted">No data yet.</p>}
        </div>
      </section>
    )
  }

  const renderExamHistory = () => (
    <section className="page">
      <div className="section-heading"><div><p className="eyebrow">HISTORY</p><h3>Exam History</h3><p className="muted">Review your previous attempts. Results are read-only.</p></div></div>
      <div className="form-card table-wrap">
        <table className="result-table"><thead><tr><th>Exam</th><th>Date</th><th>Total</th><th>Correct</th><th>Wrong</th><th>Score</th><th>Accuracy</th><th>Action</th></tr></thead><tbody>
          {myAttempts.map(a=>{const acc=a.total?Math.round(a.correct*100/a.total):0; return <tr key={a.id}><td>{a.exam_title || (a.kind==='exam'?'Exam':'Practice')}</td><td>{fmtDate(a.created_at)}</td><td>{a.total}</td><td>{a.correct}</td><td>{a.wrong}</td><td>{a.correct}/{a.total}</td><td>{acc}%</td><td><button className="secondary small-btn" onClick={()=>reviewAttempt(a.id)}>View Details</button></td></tr>})}
        </tbody></table>
        {!myAttempts.length && <p className="muted">No exam attempts yet.</p>}
      </div>
    </section>
  )

  const renderPage = () => {
    if (page === 'dashboard') return renderDashboard()
    if (page === 'subjects') return renderSubjects()
    if (page === 'examsets') return renderExamHistory()
    if (page === 'profile') return renderProfile()
    if (page === 'analytics') return renderAnalytics()
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
            {!admin && navButton('dashboard', 'Dashboard', '⌂')}
            {!admin && navButton('subjects', 'Available Exams', '▤')}
            {!admin && navButton('examsets', 'Exam History', '✎')}
            {!admin && navButton('profile', 'My Profile', '◉')}
            {!admin && navButton('analytics', 'Analytics', '📈'.replace('📈','▥'))}
            {!admin && navButton('revision', 'Revision', '↺')}
            {admin && navButton('manage', 'Questions', '☰')}
            {admin && navButton('learners', 'Students', '◌')}
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
