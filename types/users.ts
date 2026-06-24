import type { Role, Capability } from '@/lib/auth/access'

export interface UserSummary {
  id: string
  name: string
  email: string
  role: Role
  capabilities: Capability[]
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
  capabilities?: Capability[]
  sessionIds?: string[]
}

export interface CreateUserResponse {
  id: string
  /** false when the user was created but the invite email failed to send
   * (recoverable via the resend-invite action). */
  emailSent: boolean
}

export interface UpdateUserRequest {
  name?: string
  role?: Role
  capabilities?: Capability[]
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
