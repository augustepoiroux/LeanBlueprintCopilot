// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, exec } from 'child_process';
import * as os from 'os';

// BlueprintNode represents a node in the blueprint tree
class BlueprintNode extends vscode.TreeItem {
	children: BlueprintNode[];
	constructor(
		label: string,
		children: BlueprintNode[] = [],
		collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
	) {
		super(label, children.length > 0 ? collapsibleState : vscode.TreeItemCollapsibleState.None);
		this.children = children;
	}
}

// BlueprintTreeDataProvider provides the tree data for the blueprint
class BlueprintTreeDataProvider implements vscode.TreeDataProvider<BlueprintNode> {
	private _onDidChangeTreeData: vscode.EventEmitter<BlueprintNode | undefined | void> = new vscode.EventEmitter<BlueprintNode | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<BlueprintNode | undefined | void> = this._onDidChangeTreeData.event;

	private rootNodes: BlueprintNode[] = [];

	refresh(nodes: BlueprintNode[]) {
		this.rootNodes = nodes;
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: BlueprintNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: BlueprintNode): Thenable<BlueprintNode[]> {
		if (!element) {
			return Promise.resolve(this.rootNodes);
		}
		return Promise.resolve(element.children);
	}
}

export function activate(context: vscode.ExtensionContext) {
	async function installLeanblueprint(contextFolder: string): Promise<boolean> {
		function execPromise(cmd: string, options = {}): Promise<{ stdout: string, stderr: string }> {
			return new Promise((resolve, reject) => {
				exec(cmd, options, (error, stdout, stderr) => {
					if (error) {reject({ stdout, stderr });}
					else {resolve({ stdout, stderr });}
				});
			});
		}
		function isPackageInstalled(pkg: string): Promise<boolean> {
			return new Promise((resolve) => {
				exec(`dpkg -s ${pkg}`, (error) => {
					resolve(!error);
				});
			});
		}

		// Show progress bar for the whole installation process
		return await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Setting up Lean Blueprint Python environment...',
			cancellable: false
		}, async (progress) => {
			progress.report({ message: 'Checking system dependencies...' });
			try {
				// Check and install system dependencies: graphviz, python3, ...
				const pkgs = [];
				if (!await isPackageInstalled('graphviz')) { pkgs.push('graphviz'); }
				if (!await isPackageInstalled('libgraphviz-dev')) { pkgs.push('libgraphviz-dev'); }
				if (!await isPackageInstalled('python3')) { pkgs.push('python3'); }
				if (!await isPackageInstalled('python3-venv')) { pkgs.push('python3-venv'); }
				if (!await isPackageInstalled('python3-pip')) { pkgs.push('python3-pip'); }
				if (pkgs.length > 0) {
					const terminal = vscode.window.createTerminal({ name: 'Install System Dependencies' });
					terminal.show();
					terminal.sendText(`sudo apt update && sudo apt install -y ${pkgs.join(' ')}`);
					vscode.window.showWarningMessage(
						`Please complete the installation of system dependencies in the opened terminal, then retry.`
					);
					return false;
				}
			} catch (e: any) {
				vscode.window.showWarningMessage(
					"Failed to check/install system dependencies. If you are using a debian-based environment, please run the following command in your terminal, then retry:\n" +
					"sudo apt update && sudo apt install -y graphviz libgraphviz-dev python3-pip. Otherwise, please check https://pygraphviz.github.io/documentation/stable/install.html"
				);
				return false;
			}

			progress.report({ message: 'Creating Python virtual environment...' });
			// Use extension directory for pythonDir
			const pythonDir = path.join(__dirname, '..', 'python');
			const venvDir = path.join(pythonDir, '.venv');
			const pyprojectPath = path.join(pythonDir, 'pyproject.toml');
			if (!fs.existsSync(pyprojectPath)) {
				vscode.window.showErrorMessage('pyproject.toml not found in python directory.');
				return false;
			}

			// Create venv if it doesn't exist
			if (!fs.existsSync(venvDir)) {
				try {
					await execPromise('python3 -m venv .venv', { cwd: pythonDir });
				} catch (e: any) {
					vscode.window.showErrorMessage('Failed to create Python virtual environment: ' + (e.stderr || e.stdout || e.message || JSON.stringify(e)));
					return false;
				}
			}
			const venvActivate = path.join(venvDir, 'bin', 'activate');

			// Check if uv is installed
			const uvInstalled = fs.existsSync(path.join(venvDir, 'bin', 'uv'));
			if (!uvInstalled) {
				progress.report({ message: 'Installing uv in the virtual environment...' });
				// Install uv in the venv
				try {
					await execPromise(`. ${venvActivate} && pip install uv`);
				} catch (e: any) {
					vscode.window.showErrorMessage('Failed to install uv in venv: ' + (e.stderr || e.stdout || e.message || JSON.stringify(e)));
					return false;
				}
			}

			progress.report({ message: 'Installing Python dependencies with uv sync...' });
			// Use uv sync in the venv
			try {
				await execPromise(`. ${venvActivate} && uv sync`, { cwd: pythonDir, shell: '/bin/bash' });
			} catch (e: any) {
				vscode.window.showErrorMessage('Failed to install Python dependencies with uv sync: ' + (e.stderr || e.stdout || e.message || JSON.stringify(e)));
				return false;
			}
			progress.report({ message: 'Lean Blueprint is ready!' });
			return true;
		});
	}

	const createBlueprintDisposable = vscode.commands.registerCommand('leanblueprintcopilot.createBlueprintProject', async () => {
		const folderUri = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: false,
			openLabel: 'Select folder for Lean blueprint project'
		});
		if (!folderUri || folderUri.length === 0) {
			return;
		}
		const targetFolder = folderUri[0].fsPath;
		const projectName = await vscode.window.showInputBox({
			prompt: 'Enter project name',
			placeHolder: 'my_project'
		});
		if (!projectName) {return;}


		// Instantiate the Lean Blueprint project
		const ok = await installLeanblueprint(targetFolder);
		if (!ok) {return;}
		const pythonDir = path.join(__dirname, '..', 'python');
		const venvDir = path.join(pythonDir, '.venv');
		const venvLeanblueprint = path.join(venvDir, 'bin', 'leanblueprint');
		const venvActivate = path.join(venvDir, 'bin', 'activate');

		const lakeCommand = `lake init ${projectName}`;
		const blueprintCommand = `. ${venvActivate} && "${venvLeanblueprint}" new`;

		const terminal = vscode.window.createTerminal({ name: 'Lean Blueprint Init' });
		terminal.show();
		terminal.sendText(`cd "${targetFolder}" && ${lakeCommand} && ${blueprintCommand}`);

		vscode.window.showInformationMessage(`Instantiating the project`);

		// Open the new project folder as a workspace in the current window
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetFolder), false);
	});

	const parseBlueprintDisposable = vscode.commands.registerCommand('leanblueprintcopilot.parseBlueprintProject', async () => {
		const folder = getWorkspaceFolder();
		if (!folder) {
			vscode.window.showErrorMessage('No workspace folder found.');
			return;
		}
		const ok = await installLeanblueprint(folder);
		if (!ok) {return;}
		const pythonDir = path.join(__dirname, '..', 'python');
		const venvDir = path.join(pythonDir, '.venv');
		const venvActivate = path.join(venvDir, 'bin', 'activate');
		const extractorScript = path.join(pythonDir, 'extractor.py');

		if (!fs.existsSync(extractorScript)) {
			vscode.window.showErrorMessage('extractor.py not found in workspace. Please add the extraction script.');
			return;
		}

		const hiddenDir = path.join(folder, '.trace_cache');
		if (!fs.existsSync(hiddenDir)) {
			fs.mkdirSync(hiddenDir);
		}
		const blueprintDataJsonl = path.join(hiddenDir, 'blueprint_to_lean.jsonl');

		const outputChannel = vscode.window.createOutputChannel('Lean Blueprint Extraction');
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Parsing Blueprint project...' }, async () => {
			return new Promise<void>((resolve) => {
				outputChannel.clear();
				outputChannel.show(true);
				const child = require('child_process').spawn(
					'bash',
					['-c', `. "${venvActivate}" && python "${extractorScript}" --project-dir "${folder}"`],
					{ cwd: folder, env: process.env }
				);
				let stdout = '';
				let stderr = '';
				child.stdout.on('data', (data: Buffer) => {
					const str = data.toString();
					stdout += str;
					outputChannel.append(str);
				});
				child.stderr.on('data', (data: Buffer) => {
					const str = data.toString();
					stderr += str;
					outputChannel.append(str);
				});
				child.on('close', (code: number) => {
					if (code !== 0) {
						vscode.window.showErrorMessage('Error running extractor.py (see logs for details)');
						resolve();
						return;
					}
					try {
						const fileContent = fs.readFileSync(blueprintDataJsonl, 'utf8');
						const data = fileContent
							.split(/\r?\n/)
							.filter(line => line.trim().length > 0)
							.map(line => {
								try {
									return JSON.parse(line);
								} catch (e) {
									vscode.window.showWarningMessage('Skipping invalid JSONL line.');
									return null;
								}
							})
							.filter(obj => obj !== null);
						function buildTree(nodes: any[]): BlueprintNode[] {
							return nodes.map((n) => {
								const label = n.title || n.label || n.stmt_type || n.processed_text || 'Item';
								let children: BlueprintNode[] = [];
								if (n.proof) {
									children = children.concat(buildTree([n.proof]));
								}
								if (n.children) {
									children = children.concat(buildTree(n.children));
								}
								// Add Lean declaration children
								if (n.lean_declarations && Array.isArray(n.lean_declarations)) {
									n.lean_declarations.forEach((decl: any) => {
										if (decl.real_file && decl.range && decl.range.start && typeof decl.range.start.line === 'number') {
											const leanLabel = `Lean: ${decl.full_name}`;
											const leanNode = new BlueprintNode(leanLabel, [], vscode.TreeItemCollapsibleState.None);
											leanNode.command = {
												title: `Go to Lean: ${decl.full_name}`,
												command: 'vscode.open',
												arguments: [vscode.Uri.file(decl.real_file).with({ fragment: `L${decl.range.start.line + 1}` })]
											};
											leanNode.tooltip = decl.real_file + `:L${decl.range.start.line + 1}`;
											children.push(leanNode);
										}
									});
								}
								// Set collapsibleState based on children
								const collapsibleState = children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
								const node = new BlueprintNode(label, children, collapsibleState);
								const info = { ...n };
								delete info.children;
								delete info.proof;
								if (n.lean_names && Array.isArray(n.lean_names) && n.lean_names.length > 0) {
									node.description = `Lean: ${n.lean_names.join(', ')}`;
								}
								// Blueprint declaration link as main command
								if (n.label) {
									node.command = {
										title: 'Go to Blueprint Declaration',
										command: 'workbench.action.findInFiles',
										arguments: [{ query: n.label }]
									};
								}
								node.tooltip = JSON.stringify(info, null, 2);
								return node;
							});
						}
						blueprintTreeProvider.refresh(buildTree(data));
					} catch (e) {
						vscode.window.showErrorMessage('Failed to parse `blueprint_extractor.py` output.');
					}
					resolve();
				});
			});
		});
	});

	function getWorkspaceFolder(): string | undefined {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return undefined;
		}
		return folders[0].uri.fsPath;
	}

	function runLeanblueprintCommandInWorkspace(command: string, terminalName: string) {
		const folder = getWorkspaceFolder();
		if (!folder) {
			vscode.window.showErrorMessage('No workspace folder found. Please open a folder in VS Code.');
			return;
		}
		const pythonDir = path.join(__dirname, '..', 'python');
		const venvDir = path.join(pythonDir, '.venv');
		const venvLeanblueprint = path.join(venvDir, 'bin', 'leanblueprint');
		const venvActivate = path.join(venvDir, 'bin', 'activate');

		const cmd = `. ${venvActivate} && "${venvLeanblueprint}" ${command}`;

		const terminal = vscode.window.createTerminal({ name: terminalName });
		terminal.show();
		terminal.sendText(`cd "${folder}" && ${cmd}`);

		vscode.window.showInformationMessage(`Running 'leanblueprint ${command}'`);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('leanblueprintcopilot.buildPdf', () => {
			runLeanblueprintCommandInWorkspace('pdf', 'Lean Blueprint PDF');
		}),
		vscode.commands.registerCommand('leanblueprintcopilot.buildWeb', () => {
			runLeanblueprintCommandInWorkspace('web', 'Lean Blueprint Web');
		}),
		vscode.commands.registerCommand('leanblueprintcopilot.checkDecls', () => {
			runLeanblueprintCommandInWorkspace('checkdecls', 'Lean Blueprint Check Decls');
		}),
		vscode.commands.registerCommand('leanblueprintcopilot.buildAll', () => {
			runLeanblueprintCommandInWorkspace('all', 'Lean Blueprint All');
		}),
		vscode.commands.registerCommand('leanblueprintcopilot.serve', async () => {
			runLeanblueprintCommandInWorkspace('serve', 'Lean Blueprint Serve');

			// Show the served website in a VS Code webview panel
			const panel = vscode.window.createWebviewPanel(
				'leanblueprintServe',
				'Lean Blueprint Website',
				vscode.ViewColumn.Beside,
				{
					enableScripts: true,
					retainContextWhenHidden: true
				}
			);
			// Default URL (user can change port in the terminal if needed)
			const url = 'http://0.0.0.0:8000/';
			panel.webview.html = `
				<!DOCTYPE html>
				<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://0.0.0.0:8000 http://localhost:8000; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
					<title>Lean Blueprint Website</title>
					<style>body, html { margin: 0; padding: 0; height: 100%; } iframe { width: 100vw; height: 100vh; border: none; }</style>
				</head>
				<body>
					<iframe src="${url}"></iframe>
					<div style="position:absolute;top:0;left:0;width:100vw;height:100vh;pointer-events:none;"></div>
				</body>
				</html>
			`;
		})
	);

	const blueprintTreeProvider = new BlueprintTreeDataProvider();
	vscode.window.registerTreeDataProvider('leanblueprintcopilot.blueprintTree', blueprintTreeProvider);

	const didChangeEmitter = new vscode.EventEmitter<void>();

	const registerMcpServerDisposable = vscode.lm.registerMcpServerDefinitionProvider('LeanBlueprintCopilot', {
		onDidChangeMcpServerDefinitions: didChangeEmitter.event,
		provideMcpServerDefinitions: async () => {
			return await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Starting Lean Blueprint MCP server...',
				cancellable: false
			}, async (progress) => {
				const folder = getWorkspaceFolder();
				if (!folder) {
					vscode.window.showErrorMessage('No workspace folder found.');
					return;
				}
				const ok = await installLeanblueprint(folder);
				if (!ok) {return;}
				const pythonDir = path.join(__dirname, '..', 'python');
				const venvDir = path.join(pythonDir, '.venv');
				const venvActivate = path.join(venvDir, 'bin', 'activate');
				const mcpScript = path.join(pythonDir, 'mcp_server.py');

				if (!fs.existsSync(mcpScript)) {
					vscode.window.showErrorMessage('mcp_server.py not found in the Python directory.');
					return;
				}

				const port = '5000';

				let servers: vscode.McpServerDefinition[] = [];
				servers.push(new vscode.McpStdioServerDefinition(
					'LeanBlueprintCopilot',
					'bash',
					['-c', `. "${venvActivate}" && python "${mcpScript}" --port ${port}`],
					{"LEAN_BLUEPRINT_PROJECT_DIR": folder},
				));
				return servers;
			});
		},
		resolveMcpServerDefinition: async (server: vscode.McpServerDefinition) => {return server;},
	});

	context.subscriptions.push(createBlueprintDisposable, parseBlueprintDisposable, registerMcpServerDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
