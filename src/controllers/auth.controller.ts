import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import * as authService from '../services/auth.service';
import { success } from '../lib/apiResponse';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.register(req.body);
    return success(res, result, 201);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.login(req.body.email, req.body.password, req.body.remember);
    return success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: Request, res: Response) {
  return success(res, { message: 'Logged out successfully' });
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await authService.getMe(req.user!.id);
    const imp = req.impersonator;
    return success(res, imp ? { ...data, impersonator: { id: imp.id, fullName: imp.fullName, email: imp.email } } : data);
  } catch (err) {
    next(err);
  }
}
