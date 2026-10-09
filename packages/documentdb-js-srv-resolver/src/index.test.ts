import { SRV_RESOLVER_PACKAGE } from './index';

describe('SRV_RESOLVER_PACKAGE', () => {
    it('identifies this workspace package', () => {
        expect(SRV_RESOLVER_PACKAGE).toBe('@documentdb-js/srv-resolver');
    });
});
