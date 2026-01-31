import { describe, it, expect } from 'vitest';
import { getIconSVG, ICON_SVGS } from '../src/lib/icons.js';

describe('getIconSVG', () => {
  describe('issue icons', () => {
    it.each([
      [undefined, 'issue_open'],
      ['open', 'issue_open'],
      ['closed', 'issue_closed'],
    ])('should return correct icon for state "%s"', (state, expectedKey) => {
      expect(getIconSVG('issue', state)).toBe(ICON_SVGS[expectedKey]);
    });
  });

  describe('PR icons', () => {
    it.each([
      [undefined, false, 'pr_open'],
      ['open', false, 'pr_open'],
      ['closed', true, 'pr_merged'],
      ['closed', false, 'pr_closed'],
    ])('should return correct icon for state "%s" merged=%s', (state, merged, expectedKey) => {
      expect(getIconSVG('pr', state, merged)).toBe(ICON_SVGS[expectedKey]);
    });
  });

  describe('actions icons', () => {
    it.each([
      [undefined, 'actions_pending'],
      ['success', 'actions_success'],
      ['failure', 'actions_failure'],
      ['cancelled', 'actions_cancelled'],
      ['skipped', 'actions_skipped'],
      ['unknown', 'actions_pending'],
    ])('should return correct icon for conclusion "%s"', (conclusion, expectedKey) => {
      expect(getIconSVG('actions', null, null, conclusion)).toBe(ICON_SVGS[expectedKey]);
    });
  });

  describe('direct icon types', () => {
    it.each([
      ['release', 'release'],
      ['discussion', 'discussion'],
      ['commit', 'commit'],
      ['alert', 'alert'],
      ['repo', 'repo'],
    ])('should return %s icon', (iconType, expectedKey) => {
      expect(getIconSVG(iconType)).toBe(ICON_SVGS[expectedKey]);
    });
  });

  describe('fallback behavior', () => {
    it.each([
      ['unknown_type'],
      [undefined],
    ])('should return notification icon for "%s"', (iconType) => {
      expect(getIconSVG(iconType)).toBe(ICON_SVGS['notification']);
    });
  });
});

describe('ICON_SVGS', () => {
  it('should contain all expected icon keys', () => {
    const expectedKeys = [
      'issue_open',
      'issue_closed',
      'pr_open',
      'pr_closed',
      'pr_merged',
      'actions_success',
      'actions_failure',
      'actions_cancelled',
      'actions_skipped',
      'actions_pending',
      'release',
      'discussion',
      'commit',
      'alert',
      'repo',
      'notification',
    ];

    expectedKeys.forEach((key) => {
      expect(ICON_SVGS).toHaveProperty(key);
    });
  });

  it('should have valid SVG strings', () => {
    Object.values(ICON_SVGS).forEach((svg) => {
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });
  });
});
