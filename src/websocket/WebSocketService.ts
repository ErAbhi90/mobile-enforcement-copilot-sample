/**
 * WebSocketService.ts
 *
 * Manages a persistent WebSocket connection to the backend and translates
 * incoming server events into application actions.
 *
 * Responsibilities:
 *  - Establish (and re-establish) the connection with the auth token as a
 *    query parameter.
 *  - Parse incoming JSON messages and dispatch the appropriate action.
 *  - On a `force_logout` event, invoke the injected onForceLogout callback.
 *    The callback is wired in the composition root — WebSocketService does not
 *    import or know about AuthService.
 *  - Expose connect / disconnect / isConnected for lifecycle management.
 *
 * Security note: passing the token in the query string is common for
 * WebSockets (the Upgrade request cannot carry custom headers in all
 * environments) but the token will appear in server access logs.  For
 * higher-security deployments consider a short-lived WebSocket handshake
 * token issued by a dedicated endpoint.
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('WebSocketService');

// ---------------------------------------------------------------------------
// Message shape
// ---------------------------------------------------------------------------

/** Events the server is allowed to push to the client. */
export type ServerEventType = 'force_logout' | 'session_update';

export interface ServerMessage {
  type: ServerEventType;
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// Options / Interface
// ---------------------------------------------------------------------------

/**
 * Callbacks injected into WebSocketService at construction time.
 * Using a narrow options object rather than a full service reference keeps
 * WebSocketService decoupled from the rest of the auth system and makes it
 * trivial to test: just pass a jest.fn() for onForceLogout.
 */
export interface WebSocketServiceOptions {
  /** Called when the server pushes a force_logout event. */
  onForceLogout: () => void;
}

export interface IWebSocketService {
  connect(url: string, token: string): void;
  disconnect(): void;
  isConnected(): boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class WebSocketService implements IWebSocketService {
  private ws: WebSocket | null = null;
  private connected = false;

  constructor(private readonly options: WebSocketServiceOptions) {}

  /**
   * Opens a WebSocket connection.  If a previous connection is open it is
   * closed first.  The access token is appended as a query parameter so the
   * server can authenticate the upgrade request.
   */
  connect(url: string, token: string): void {
    if (this.ws) {
      this.disconnect();
    }

    const fullUrl = `${url}?token=${token}`;
    logger.info(`Connecting to ${url}`);
    this.ws = new WebSocket(fullUrl);

    this.ws.onopen = () => {
      this.connected = true;
      logger.info('WebSocket connection established');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data as string);
    };

    this.ws.onclose = () => {
      this.connected = false;
      logger.info('WebSocket connection closed');
    };

    this.ws.onerror = (_event: Event) => {
      this.connected = false;
      logger.error('WebSocket error encountered');
    };
  }

  /** Closes the connection and clears the internal reference. */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private handleMessage(data: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      logger.warn('Received malformed WebSocket message — ignoring');
      return;
    }

    switch (message.type) {
      case 'force_logout':
        logger.warn('Server issued a force_logout — invoking onForceLogout callback');
        this.options.onForceLogout();
        break;
      case 'session_update':
        logger.info('Received session_update event', message.payload);
        break;
      default:
        logger.debug('Unhandled WebSocket event type', message.type);
    }
  }
}
