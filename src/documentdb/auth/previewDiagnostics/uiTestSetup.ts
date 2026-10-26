import { beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';

beforeEach((): void => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Continue' as never);
});
