/** 기획서 2-1 — JWT + bcrypt 인증. */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

const JWT_SECRET = process.env.JWT_SECRET ?? 'eternia-dev-secret-change-me';
const TOKEN_TTL = '7d';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('운영 환경에서는 JWT_SECRET 환경변수가 반드시 필요합니다.');
}

export interface TokenPayload {
  accountId: string;
  email: string;
}

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, 10);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

export const issueToken = (payload: TokenPayload): string =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  auth?: TokenPayload;
}

/** Authorization: Bearer <token> */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: '인증이 필요합니다.' });
    return;
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    res.status(401).json({ error: 'INVALID_TOKEN', message: '토큰이 유효하지 않습니다.' });
    return;
  }
  req.auth = payload;
  next();
}

/** 이메일 형식 검사 — 계정 생성 전 최소 검증 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** 비밀번호 정책 — 8자 이상, 영문과 숫자 포함 */
export function passwordIssue(password: string): string | null {
  if (password.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return '비밀번호는 영문과 숫자를 모두 포함해야 합니다.';
  }
  return null;
}
