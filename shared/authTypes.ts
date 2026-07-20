// Request/response shapes for the /auth/* HTTP API, shared by the client's
// fetch wrappers and the server's route handlers. Separate from types.ts
// because that file is scoped to the GameSession ClientMsg/ServerMsg
// protocol — this is a plain JSON API, not part of the game reducer.

export interface AuthUser {
  username: string;
  provider: 'local' | 'google';
}

export interface RegisterBody {
  username: string;
  password: string;
}

export interface LoginBody {
  username: string;
  password: string;
}

export interface MeResponse {
  user: AuthUser | null;
}

export interface AuthErrorResponse {
  error: string;
}
