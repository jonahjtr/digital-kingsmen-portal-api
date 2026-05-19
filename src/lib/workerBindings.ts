import type { CloudflareBindings } from '../types/cloudflare';

let bindings: CloudflareBindings | null = null;

export function setWorkerBindings(env: CloudflareBindings): void {
  bindings = env;
}

export function getWorkerBindings(): CloudflareBindings | null {
  return bindings;
}
