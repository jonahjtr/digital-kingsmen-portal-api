export type PartyEventType =
  | 'message.created'
  | 'message.read'
  | 'notification.created'
  | 'notification.read'
  | 'notifications.read_all';

export interface PartyEvent<T = unknown> {
  type: PartyEventType | string;
  payload: T;
}

export interface PartyBroadcastBody extends PartyEvent {
  tags?: string[];
}
