import { describe, expect, it } from 'vitest';
import { usageByline } from './usageByline';

describe('usageByline', () => {
    it('omits unknown fields', () => {
        expect(usageByline(undefined)).toBe('');
        expect(usageByline({ promptTokens: 10 })).toBe('');
    });
    it('formats exact zero, tiny credits and up to two decimals', () => {
        expect(usageByline({ credits: 0 })).toBe(' · 0 credits');
        expect(usageByline({ credits: 0.0001 })).toBe(' · < 0.01 credits');
        expect(usageByline({ credits: 1.236, promptTokens: 1000, responseTokens: 20 }))
            .toBe(' · 1.24 credits · 1,000 in / 20 out tokens');
    });
});
