/**
 * Tickets module. Self-contained: config, rules (service), SLA math, event bus, subscribers, routes.
 * Wire-up is these two lines in the app; everything else lives in this folder.
 */
import { registerTicketSubscribers } from './subscribers';
export { default as ticketRoutes } from './routes';
export { autoCloseResolved } from './service';

registerTicketSubscribers();
