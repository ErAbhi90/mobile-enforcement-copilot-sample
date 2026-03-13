/**
 * SessionManager.ts
 *
 * Manages the lifecycle of a user session.  A session is a JSON snapshot
 * stored in secure storage that records who is logged in and when the session
 * started.
 *
 * Key responsibilities:
 *  - Start a new session (called after successful login).
 *  - Decide whether a stored session is still valid (< 10 hours old).
 *  - Clear the session on logout or expiry.
 *
 * The 10-hour expiry is enforced on every isSessionValid() call so that the
 * check is always up-to-date, even if the device was offline for a long time.
 */

import { ISecureStorageService } from '../storage/SecureStorageService';
import { SessionData } from '../types/auth.types';
import { StorageKeys } from '../storage/StorageKeys';

/** Storage key for the session JSON blob — defined once in StorageKeys.ts. */
const SESSION_KEY = StorageKeys.SESSION_DATA;

/** Maximum session age in milliseconds (10 hours). */
export const SESSION_DURATION_MS = 10 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ISessionManager {
  startSession(userId: string): Promise<void>;
  getSessionData(): Promise<SessionData | null>;
  isSessionValid(): Promise<boolean>;
  clearSession(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SessionManager implements ISessionManager {
  constructor(private readonly storageService: ISecureStorageService) {}

  /**
   * Persists a new session record stamped with the current time.
   * Call this immediately after a successful login API response.
   */
  async startSession(userId: string): Promise<void> {
    const session: SessionData = {
      userId,
      createdAt: Date.now(),
    };
    await this.storageService.setItem(SESSION_KEY, JSON.stringify(session));
  }

  /**
   * Reads and parses the stored session, or returns null if none exists or
   * the stored value is corrupted.
   */
  async getSessionData(): Promise<SessionData | null> {
    const raw = await this.storageService.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      // Corrupted entry — treat as no session.
      return null;
    }
  }

  /**
   * Returns true only when a session exists AND was created within the last
   * SESSION_DURATION_MS milliseconds.
   */
  async isSessionValid(): Promise<boolean> {
    const session = await this.getSessionData();
    if (!session) {
      return false;
    }
    return Date.now() - session.createdAt < SESSION_DURATION_MS;
  }

  /** Removes the session record from secure storage. */
  async clearSession(): Promise<void> {
    await this.storageService.removeItem(SESSION_KEY);
  }
}
