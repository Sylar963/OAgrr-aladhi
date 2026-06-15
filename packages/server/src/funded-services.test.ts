import { afterEach, describe, expect, it } from 'vitest';
import { isFundedEnabled } from './funded-services.js';

const prev = process.env['FUNDED_PROGRAM_ENABLED'];

afterEach(() => {
  if (prev === undefined) delete process.env['FUNDED_PROGRAM_ENABLED'];
  else process.env['FUNDED_PROGRAM_ENABLED'] = prev;
});

describe('isFundedEnabled', () => {
  it('is false when unset', () => {
    delete process.env['FUNDED_PROGRAM_ENABLED'];
    expect(isFundedEnabled()).toBe(false);
  });
  it('is true when set to 1', () => {
    process.env['FUNDED_PROGRAM_ENABLED'] = '1';
    expect(isFundedEnabled()).toBe(true);
  });
  it('is true when set to true', () => {
    process.env['FUNDED_PROGRAM_ENABLED'] = 'true';
    expect(isFundedEnabled()).toBe(true);
  });
  it('is false for other values', () => {
    process.env['FUNDED_PROGRAM_ENABLED'] = '0';
    expect(isFundedEnabled()).toBe(false);
  });
});
