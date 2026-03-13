/**
 * WebSocketService.test.ts
 *
 * Unit tests for the WebSocketService.
 *
 * The global WebSocket constructor is replaced with a controllable stub that
 * exposes helper methods (simulateOpen, simulateMessage, simulateClose) so
 * tests can drive the full message lifecycle synchronously.
 *
 * Test plan:
 *  - connect() creates a WebSocket to the expected URL with the token.
 *  - After the connection opens, isConnected() returns true.
 *  - A `force_logout` message triggers authService.logout(FORCE_LOGOUT).
 *  - An unrelated message type does NOT trigger logout.
 *  - A malformed (non-JSON) message is ignored without throwing.
 *  - disconnect() closes the socket and isConnected() returns false.
 *  - connect() disconnects any existing connection before opening a new one.
 */

import { WebSocketService } from '../../src/websocket/WebSocketService';
import { IAuthService } from '../../src/auth/AuthService';
import { AuthState, LogoutReason } from '../../src/types/auth.types';

// ---------------------------------------------------------------------------
// WebSocket stub
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  close = jest.fn(() => this.onclose?.());

  simulateOpen(): void {
    this.onopen?.();
  }
  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }
  simulateClose(): void {
    this.onclose?.();
  }
  simulateError(): void {
    this.onerror?.(new Event('error'));
  }
}

// Replace the global WebSocket with our stub before the tests run.
const originalWebSocket = global.WebSocket;
beforeAll(() => {
  global.WebSocket = jest.fn().mockImplementation(() => {
    const instance = new MockWebSocket();
    MockWebSocket.instances.push(instance);
    return instance;
  }) as unknown as typeof WebSocket;
});
afterAll(() => {
  global.WebSocket = originalWebSocket;
});

// ---------------------------------------------------------------------------
// Auth service mock
// ---------------------------------------------------------------------------

const mockAuthService: jest.Mocked<
  Pick<IAuthService, 'logout' | 'login' | 'isAuthenticated' | 'getAccessToken' | 'onStateChange'>
> = {
  logout: jest.fn(),
  login: jest.fn(),
  isAuthenticated: jest.fn(),
  getAccessToken: jest.fn(),
  onStateChange: jest.fn((cb: (state: AuthState) => void) => {
    cb({ isAuthenticated: false, isLoading: false });
    return jest.fn();
  }),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketService', () => {
  let wsService: WebSocketService;
  let latestWs: MockWebSocket;

  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    wsService = new WebSocketService(mockAuthService as unknown as IAuthService);
    jest.clearAllMocks();
  });

  const connect = (url = 'ws://localhost:8080', token = 'my-token'): MockWebSocket => {
    wsService.connect(url, token);
    latestWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    return latestWs;
  };

  it('should open a WebSocket to the URL with the token as a query param', () => {
    connect('ws://enforcement-api.local', 'token-abc');
    expect(global.WebSocket).toHaveBeenCalledWith('ws://enforcement-api.local?token=token-abc');
  });

  it('should report isConnected() true after the socket opens', () => {
    const ws = connect();
    ws.simulateOpen();
    expect(wsService.isConnected()).toBe(true);
  });

  it('should trigger force logout when a force_logout message arrives', () => {
    const ws = connect();
    ws.simulateOpen();
    ws.simulateMessage(JSON.stringify({ type: 'force_logout' }));
    expect(mockAuthService.logout).toHaveBeenCalledWith(LogoutReason.FORCE_LOGOUT);
  });

  it('should NOT trigger logout for non-force_logout message types', () => {
    const ws = connect();
    ws.simulateOpen();
    ws.simulateMessage(JSON.stringify({ type: 'session_update', payload: { ttl: 3600 } }));
    expect(mockAuthService.logout).not.toHaveBeenCalled();
  });

  it('should ignore malformed (non-JSON) messages without throwing', () => {
    const ws = connect();
    ws.simulateOpen();
    expect(() => ws.simulateMessage('not valid json }')).not.toThrow();
    expect(mockAuthService.logout).not.toHaveBeenCalled();
  });

  it('should set isConnected() to false after disconnect()', () => {
    const ws = connect();
    ws.simulateOpen();
    wsService.disconnect();
    expect(wsService.isConnected()).toBe(false);
  });

  it('should set isConnected() to false when the socket closes', () => {
    const ws = connect();
    ws.simulateOpen();
    ws.simulateClose();
    expect(wsService.isConnected()).toBe(false);
  });

  it('should close the previous socket when connect() is called again', () => {
    const ws1 = connect('ws://host1', 'token1');
    ws1.simulateOpen();
    connect('ws://host2', 'token2'); // triggers re-connect
    expect(ws1.close).toHaveBeenCalledTimes(1);
  });
});
