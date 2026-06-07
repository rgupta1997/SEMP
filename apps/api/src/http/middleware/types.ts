// Express Request augmentation for the authenticated user.
export interface AuthUser {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  accountType: string;
  institutionId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
