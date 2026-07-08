export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER'

export interface User {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  oauthProvider: string | null
  createdAt: string
  updatedAt: string
}

export interface AuthResponse {
  user: User
  accessToken: string
  refreshToken: string
}

export interface WorkspaceSummary {
  id: string
  name: string
  slug: string
  ownerId: string
  createdAt: string
  updatedAt: string
  _count?: { members?: number; tasks?: number; channels?: number }
}

export interface MemberUser {
  id: string
  name: string | null
  email: string
  avatarUrl: string | null
}

export interface WorkspaceMember {
  id: string
  userId: string
  workspaceId: string
  role: WorkspaceRole
  joinedAt: string
  user: MemberUser
}

export interface WorkspaceDetail extends WorkspaceSummary {
  owner: MemberUser
  members: WorkspaceMember[]
}

export interface TaskAssignee {
  id: string
  name: string | null
  avatarUrl: string | null
}

export interface Task {
  id: string
  title: string
  description: string | null
  workspaceId: string
  creatorId: string
  assigneeId: string | null
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  createdAt: string
  updatedAt: string
  assignee?: TaskAssignee | null
  _count?: { comments?: number; attachments?: number }
}

export const TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']
export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
