// packages/web/src/lib/onboarding.ts

const ONBOARDING_SEEN_KEY = 'onboardingSeen';

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    /* ignore quota / unavailable storage */
  }
}
