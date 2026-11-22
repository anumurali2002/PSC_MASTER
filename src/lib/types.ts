export type Role = 'admin' | 'learner'

export type Profile = {
  id: string
  email: string
  name: string
  role: Role
  created_at?: string
}

export type Question = {
  id: number
  subject: string
  topic: string
  qtext: string
  options: string[]
  answer: number
  difficulty?: string
  explanation?: string
}

export type CatalogItem = {
  subject: string
  topic: string
  n: number
}

export type Attempt = {
  id: number
  user_id: string
  exam_id: number | null
  total: number
  correct: number
  wrong: number
  skipped: number
  created_at: string
}

export type ExamSummary = {
  id: number
  title: string
  created_at: string
  size: number
  subjects: string[]
  attempt_id: number | null
  correct: number
  total: number
}

export type ReviewItem = {
  id: number
  qtext: string
  options: string[]
  chosen: number | null
  answer: number
  explanation: string
}

export type GradeResult = {
  total: number
  correct: number
  wrong: number
  skipped: number
  review: ReviewItem[]
  attempt_id?: number
}

export type ManagedUser = {
  id: string
  email: string
  name: string
  role: Role
  created_at: string | null
}
