import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import rootConfig from '../../../../vitest.config';

// Existing handler suites need a UI answer in this intentionally modal preview build.
const project = rootConfig.test?.projects?.[0];
if (!project || typeof project !== 'object' || !('test' in project) || !project.test) {
    throw new Error('Extension test project missing');
}

export default defineConfig({
    test: {
        ...rootConfig.test,
        projects: [{
            ...project,
            test: {
                ...project.test,
                setupFiles: [
                    ...(Array.isArray(project.test.setupFiles) ? project.test.setupFiles : []),
                    fileURLToPath(new URL('./uiTestSetup.ts', import.meta.url)),
                ],
            },
        }],
    },
});
