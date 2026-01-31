import { describe, it, expect } from 'vitest';
import {
  formatReason,
  formatType,
  formatState,
  getNotificationStatus,
  escapeHtml,
  escapeAttr,
} from '../src/lib/format-utils.js';

describe('formatReason', () => {
  it.each([
    ['subscribed', 'Subscribed'],
    ['participating', 'Participating'],
    ['mentioned', 'Mentioned'],
    ['team_mention', 'Team Mentioned'],
    ['comment', 'Commented'],
    ['review_requested', 'Review Requested'],
    ['security_alert', 'Security Alert'],
    ['state_change', 'State Changed'],
    ['assign', 'Assigned'],
    ['author', 'You Authored'],
    ['manual', 'Manual'],
    ['ci_activity', 'CI Activity'],
  ])('should format "%s" as "%s"', (input, expected) => {
    expect(formatReason(input)).toBe(expected);
  });

  it('should return original value for unknown reasons', () => {
    expect(formatReason('custom_reason')).toBe('custom_reason');
  });

  it.each([
    [null, 'Unknown'],
    [undefined, 'Unknown'],
  ])('should handle %s as "Unknown"', (input, expected) => {
    expect(formatReason(input)).toBe(expected);
  });
});

describe('formatType', () => {
  it.each([
    ['Issue', 'Issue'],
    ['PullRequest', 'Pull Request'],
    ['Release', 'Release'],
    ['Discussion', 'Discussion'],
    ['Commit', 'Commit'],
    ['CheckSuite', 'CI Activity'],
  ])('should format "%s" as "%s"', (input, expected) => {
    expect(formatType(input)).toBe(expected);
  });

  it('should return original value for unknown types', () => {
    expect(formatType('CustomType')).toBe('CustomType');
  });

  it.each([
    [null, 'Notification'],
    [undefined, 'Notification'],
  ])('should handle %s as "Notification"', (input, expected) => {
    expect(formatType(input)).toBe(expected);
  });
});

describe('formatState', () => {
  it.each([
    ['open', 'Open'],
    ['closed', 'Closed'],
    ['merged', 'Merged'],
    ['success', 'Success'],
    ['failure', 'Failure'],
    ['cancelled', 'Cancelled'],
    ['skipped', 'Skipped'],
    ['pending', 'Pending'],
  ])('should format "%s" as "%s"', (input, expected) => {
    expect(formatState(input)).toBe(expected);
  });

  it('should return original value for unknown states', () => {
    expect(formatState('custom_state')).toBe('custom_state');
  });

  it.each([
    [null, ''],
    [undefined, ''],
  ])('should return empty string for %s', (input, expected) => {
    expect(formatState(input)).toBe(expected);
  });
});

describe('getNotificationStatus', () => {
  it('should return type with conclusion for CI notifications', () => {
    const notif = { type: 'CheckSuite', conclusion: 'success' };
    expect(getNotificationStatus(notif)).toBe('CI Activity (Success)');
  });

  it('should return type with Merged for merged PRs', () => {
    const notif = { type: 'PullRequest', merged: true, state: 'closed' };
    expect(getNotificationStatus(notif)).toBe('Pull Request (Merged)');
  });

  it('should return type with state for issues/PRs', () => {
    const notif = { type: 'Issue', state: 'open' };
    expect(getNotificationStatus(notif)).toBe('Issue (Open)');
  });

  it('should return type only when no state/conclusion', () => {
    const notif = { type: 'Release' };
    expect(getNotificationStatus(notif)).toBe('Release');
  });
});

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"quotes"')).toBe('&quot;quotes&quot;');
    expect(escapeHtml("'apostrophe'")).toBe('&#39;apostrophe&#39;');
  });

  it('should handle combined special characters', () => {
    expect(escapeHtml('<a href="url">link</a>')).toBe(
      '&lt;a href=&quot;url&quot;&gt;link&lt;/a&gt;'
    );
  });

  it('should handle null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('should convert non-string values to string', () => {
    expect(escapeHtml(123)).toBe('123');
    expect(escapeHtml(true)).toBe('true');
  });
});

describe('escapeAttr', () => {
  it('should escape HTML for attribute values', () => {
    expect(escapeAttr('<test>')).toBe('&lt;test&gt;');
    expect(escapeAttr('"value"')).toBe('&quot;value&quot;');
  });
});