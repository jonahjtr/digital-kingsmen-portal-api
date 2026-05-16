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
    const result = await authService.login(req.body.email, req.body.password);
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
    return success(res, data);
  } catch (err) {
    next(err);
  }
}
