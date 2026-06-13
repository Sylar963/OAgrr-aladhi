export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.oggregator.xyz';

// Owner-supplied via Vercel env; components render contact affordances only when set.
export const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null;

export const xUrl = process.env.NEXT_PUBLIC_X_URL ?? null;
