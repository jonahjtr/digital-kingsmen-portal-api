export interface GhlContact {
  id?: string;
  email: string;
  name: string;
}

export interface GhlClient {
  syncContact(contact: GhlContact): Promise<void>;
  createOpportunity(data: Record<string, unknown>): Promise<void>;
}

export class NoOpGhlClient implements GhlClient {
  async syncContact(): Promise<void> {
    // Future implementation
  }
  async createOpportunity(): Promise<void> {
    // Future implementation
  }
}

export function getGhlClient(): GhlClient {
  return new NoOpGhlClient();
}
