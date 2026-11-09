/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsRowDetails } from './DiagnosticsRowDetails';
import { type PanelEvidenceDetail, type PanelKubernetesPortForward } from './panelTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@vscode/l10n', () => ({ t: (message: string): string => message }));

type Settings = Extract<PanelEvidenceDetail, { kind: 'connectionSettings' }>;
const mounted: { host: HTMLElement; root: Root }[] = [];

function settings(tunnel: 'started' | 'reused'): Settings & { kubernetesPortForward: PanelKubernetesPortForward } {
    return {
        kind: 'connectionSettings', scheme: 'mongodb', hosts: ['127.0.0.1:10260'], user: 'db-user',
        passwordPresent: true, authMethod: 'native', authSource: { value: 'admin', origin: 'uri' }, options: [],
        kubernetesPortForward: {
            context: 'arn:aws:eks:us-east-1:123456789012:cluster/private-cluster',
            namespace: 'private-ns', service: 'private-svc', servicePort: 10261, localPort: 10260,
            tunnel, readyPodFound: true,
        },
    };
}

async function render(evidence: Settings): Promise<HTMLElement> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async (): Promise<void> => {
        root.render(<DiagnosticsRowDetails details={{ findings: [], evidence: [evidence] }} />);
    });
    return host;
}

function rows(host: HTMLElement): [string, string][] {
    return [...host.querySelectorAll('dt')].map((term): [string, string] => [
        term.textContent ?? '', term.nextElementSibling?.textContent ?? '',
    ]);
}

afterEach(async (): Promise<void> => {
    for (const { host, root } of mounted.splice(0)) {
        await act(async (): Promise<void> => root.unmount());
        host.remove();
    }
});

describe('DiagnosticsRowDetails Kubernetes port forward', (): void => {
    it.each(['started', 'reused'] as const)('renders the %s tunnel as compact term/description rows', async (tunnel): Promise<void> => {
        const host = await render(settings(tunnel));
        expect(rows(host)).toEqual([
            ['Scheme', 'mongodb'],
            ['Host', '127.0.0.1:10260 (local end of the Kubernetes port forward)'],
            ['User', 'db-user'], ['Password', '(hidden)'],
            ['Authentication method', 'Username and password'], ['Authentication database', 'admin'],
            ['Options', 'None'],
            ['Kubernetes context', 'arn:aws:eks:us-east-1:123456789012:cluster/private-cluster'],
            ['Namespace', 'private-ns'], ['Service', 'private-svc:10261'], ['Local port', '10260'],
            ['Port forward', tunnel === 'started' ? 'Started by this check' : 'Already open (reused)'],
            ['Backend', 'Ready pod found at check time'],
        ]);
        const annotation = [...host.querySelectorAll('span')].find((span): boolean =>
            span.textContent?.trim() === '(local end of the Kubernetes port forward)',
        );
        expect(annotation?.textContent).not.toMatch(/arn:|123456789012|private-/);
        expect(host.textContent).toContain('Kubernetes port forward');
    });

    it('does not imply a port forward for an ordinary loopback connection', async (): Promise<void> => {
        const { kubernetesPortForward, ...ordinary } = settings('started');
        expect(kubernetesPortForward).toBeDefined();
        const host = await render(ordinary);
        expect(rows(host)).toContainEqual(['Host', '127.0.0.1:10260']);
        expect(host.textContent).not.toMatch(/Kubernetes|Namespace|Service|Backend|Ready pod|Port forward/);
    });

    it('omits ready-pod evidence when that observation is absent', async (): Promise<void> => {
        const evidence = settings('reused');
        const host = await render({
            ...evidence,
            kubernetesPortForward: { ...evidence.kubernetesPortForward, readyPodFound: false },
        });
        expect(host.textContent).not.toMatch(/Backend|Ready pod/);
    });

    it('does not annotate a host that is not the local tunnel endpoint', async (): Promise<void> => {
        const host = await render({ ...settings('started'), hosts: ['other.example:10260', '127.0.0.1:10261'] });
        expect(host.textContent).not.toContain('(local end of the Kubernetes port forward)');
    });
});
