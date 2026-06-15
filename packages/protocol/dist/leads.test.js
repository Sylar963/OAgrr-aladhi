import { describe, expect, it } from 'vitest';
import { LeadCaptureRequestSchema } from './leads.js';
describe('LeadCaptureRequestSchema', () => {
    it('accepts a valid lead and normalizes the email', () => {
        const parsed = LeadCaptureRequestSchema.parse({ email: '  Desk@Fund.com ', source: 'hero' });
        expect(parsed).toEqual({ email: 'desk@fund.com', source: 'hero' });
    });
    it('rejects a malformed email', () => {
        expect(LeadCaptureRequestSchema.safeParse({ email: 'nope', source: 'hero' }).success).toBe(false);
    });
    it('rejects an empty source', () => {
        expect(LeadCaptureRequestSchema.safeParse({ email: 'a@b.co', source: '' }).success).toBe(false);
    });
});
//# sourceMappingURL=leads.test.js.map