import type { Role } from '@/lib/auth/access'

export interface UserSummary {
  id: string
  name: string
  email: string
  role: Role
  created_at: string
  assignedCount: number
}

export interface ListUsersResponse {
  users: UserSummary[]
}

export interface CreateUserRequest {
  name: string
  email: string
  role: Role
  sessionIds?: string[]
}

export interface CreateUserResponse {
  id: string
}

export interface UpdateUserRequest {
  name?: string
  role?: Role
}

export interface UpdateAssignmentsRequest {
  sessionIds: string[]
}

export interface AssignedClient {
  session_id: string
  website_url: string
}

export interface UserAssignmentsResponse {
  assigned: AssignedClient[]
}

export interface ResetPasswordResponse {
  link: string
}
