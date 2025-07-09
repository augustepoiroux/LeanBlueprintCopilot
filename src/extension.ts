// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, exec } from 'child_process';
import * as os from 'os';

// Status type for filtering
export type BlueprintStatus = 'formalized' | 'non-formalized';

// BlueprintNode represents a node in the blueprint tree
class BlueprintNode extends vscode.TreeItem {
	children: BlueprintNode[];
	blueprintData: any; // Store the original blueprint data
	isFormalized: boolean;

	constructor(
		label: string,
		children: BlueprintNode[] = [],
		collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
		blueprintData: any = null
	) {
		super(label, children.length > 0 ? collapsibleState : vscode.TreeItemCollapsibleState.None);
		this.children = children;
		this.blueprintData = blueprintData;
		this.isFormalized = blueprintData ? this.calculateFormalizationStatus(blueprintData) : false;

		// Set context value for context menu
		this.contextValue = this.isFormalized ? 'formalizedNode' : 'unformalizedNode';

		// Add icon based on formalization status
		if (this.blueprintData && this.blueprintData.stmt_type) {
			this.iconPath = new vscode.ThemeIcon(
				this.isFormalized ? 'check' : 'circle-outline',
				this.isFormalized ? undefined : new vscode.ThemeColor('problemsWarningIcon.foreground')
			);
		}
	}

	private calculateFormalizationStatus(data: any): boolean {
		// A node is considered formalized if it has leanok flag or is fully proved
		return !!(data.leanok || data.fully_proved || (data.lean_declarations && data.lean_declarations.length > 0));
	}
}

// BlueprintTreeDataProvider provides the tree data for the blueprint with filtering capabilities
class BlueprintTreeDataProvider implements vscode.TreeDataProvider<BlueprintNode> {
	private _onDidChangeTreeData: vscode.EventEmitter<BlueprintNode | undefined | void> = new vscode.EventEmitter<BlueprintNode | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<BlueprintNode | undefined | void> = this._onDidChangeTreeData.event;

	private rootNodes: BlueprintNode[] = [];
	private showOnlyUnformalized: boolean = false;

	private statusFilter: Set<BlueprintStatus> = new Set(['formalized', 'non-formalized']);

	private _searchText: string = '';

	refresh(nodes: BlueprintNode[]) {
		this.rootNodes = nodes;
		this._onDidChangeTreeData.fire();
	}

	setFilter(showOnlyUnformalized: boolean) {
		this.showOnlyUnformalized = showOnlyUnformalized;
		this._onDidChangeTreeData.fire();
	}

	setStatusFilter(statuses: BlueprintStatus[]) {
		this.statusFilter = new Set(statuses);
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: BlueprintNode): vscode.TreeItem {
		// Add command for unformalized nodes
		if (!element.isFormalized && element.blueprintData && element.blueprintData.stmt_type) {
			element.command = {
				title: 'Select for Formalization',
				command: 'leanblueprintcopilot.selectNodeForFormalization',
				arguments: [element.blueprintData]
			};
		}
		return element;
	}

	getChildren(element?: BlueprintNode): Thenable<BlueprintNode[]> {
		if (!element) {
			return Promise.resolve(this.filterNodesByStatus(this.rootNodes));
		}
		return Promise.resolve(this.filterNodesByStatus(element.children));
	}

	private filterUnformalizedNodes(nodes: BlueprintNode[]): BlueprintNode[] {
		const result: BlueprintNode[] = [];

		for (const node of nodes) {
			if (!node.isFormalized && node.blueprintData && node.blueprintData.stmt_type) {
				// Include the unformalized node
				result.push(node);
			} else if (node.children.length > 0) {
				// Check if any children are unformalized
				const unformalizedChildren = this.filterUnformalizedNodes(node.children);
				if (unformalizedChildren.length > 0) {
					// Create a copy of the node with only unformalized children
					const filteredNode = new BlueprintNode(
						node.label as string,
						unformalizedChildren,
						vscode.TreeItemCollapsibleState.Expanded,
						node.blueprintData
					);
					filteredNode.description = `${unformalizedChildren.length} unformalized`;
					filteredNode.iconPath = new vscode.ThemeIcon('folder');
					result.push(filteredNode);
				}
			}
		}

		return result;
	}

	private filterNodesByStatus(nodes: BlueprintNode[]): BlueprintNode[] {
		const result: BlueprintNode[] = [];
		const showFormalized = this.statusFilter.has('formalized');
		const showNonFormalized = this.statusFilter.has('non-formalized');

		for (const node of nodes) {
			const isFormalized = node.isFormalized;
			// If only non-formalized is selected, show only non-formalized nodes and their relevant parents
			if (!showFormalized && showNonFormalized) {
				if (!isFormalized) {
					// Node is non-formalized, include it (with filtered children)
					const filteredChildren = this.filterNodesByStatus(node.children);
					const filteredNode = new BlueprintNode(
						node.label as string,
						filteredChildren,
						filteredChildren.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
						node.blueprintData
					);
					filteredNode.description = node.description;
					filteredNode.iconPath = node.iconPath;
					filteredNode.command = node.command;
					filteredNode.tooltip = node.tooltip;
					result.push(filteredNode);
				} else if (node.children.length > 0) {
					// Node is formalized, but may have non-formalized descendants
					const filteredChildren = this.filterNodesByStatus(node.children);
					if (filteredChildren.length > 0) {
						const filteredNode = new BlueprintNode(
							node.label as string,
							filteredChildren,
							vscode.TreeItemCollapsibleState.Expanded,
							node.blueprintData
						);
						filteredNode.description = node.description;
						filteredNode.iconPath = new vscode.ThemeIcon('folder');
						filteredNode.tooltip = node.tooltip;
						result.push(filteredNode);
					}
				}
			} else {
				// Default: show nodes matching the selected statuses
				if ((isFormalized && showFormalized) || (!isFormalized && showNonFormalized)) {
					const filteredChildren = this.filterNodesByStatus(node.children);
					const filteredNode = new BlueprintNode(
						node.label as string,
						filteredChildren,
						filteredChildren.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
						node.blueprintData
					);
					filteredNode.description = node.description;
					filteredNode.iconPath = node.iconPath;
					filteredNode.command = node.command;
					filteredNode.tooltip = node.tooltip;
					result.push(filteredNode);
				} else if (node.children.length > 0) {
					const filteredChildren = this.filterNodesByStatus(node.children);
					if (filteredChildren.length > 0) {
						const filteredNode = new BlueprintNode(
							node.label as string,
							filteredChildren,
							vscode.TreeItemCollapsibleState.Expanded,
							node.blueprintData
						);
						filteredNode.description = node.description;
						filteredNode.iconPath = new vscode.ThemeIcon('folder');
						filteredNode.tooltip = node.tooltip;
						result.push(filteredNode);
					}
				}
			}
		}
		return result;
	}

	// Add searchText and setSearchText to the provider
	setSearchText(text: string) {
		this._searchText = text;
		this._onDidChangeTreeData.fire();
	}
}

export function activate(context: vscode.ExtensionContext) {
	async function installLeanblueprint(contextFolder: string): Promise<boolean> {
		// Detect platform
		const isWindows = process.platform === 'win32';
		function execPromise(cmd: string, options = {}): Promise<{ stdout: string, stderr: string }> {
			return new Promise((resolve, reject) => {
				exec(cmd, { ...options, shell: isWindows ? 'cmd.exe' : '/bin/bash' }, (error, stdout, stderr) => {
					if (error) {reject({ stdout, stderr });}
					else {resolve({ stdout, stderr });}
				});
			});
		}
		function isPackageInstalled(pkg: string): Promise<boolean> {
			if (isWindows) {
				// On Windows, check if executable is in PATH
				return new Promise((resolve) => {
					exec(`where ${pkg}`, (error) => {
						resolve(!error);
					});
				});
			} else {
				return new Promise((resolve) => {
					exec(`dpkg -s ${pkg}`, (error) => {
						resolve(!error);
					});
				});
			}
		}

		// Show progress bar for the whole installation process
		return await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Setting up Lean Blueprint Python environment...',
			cancellable: false
		}, async (progress) => {
			progress.report({ message: 'Checking system dependencies...' });
			try {
				const pkgs = [];
				if (!await isPackageInstalled('graphviz')) { pkgs.push('graphviz'); }
				if (!isWindows && !await isPackageInstalled('libgraphviz-dev')) { pkgs.push('libgraphviz-dev'); }
				if (!await isPackageInstalled(isWindows ? 'python' : 'python3')) { pkgs.push(isWindows ? 'python' : 'python3'); }
				if (!isWindows && !await isPackageInstalled('python3-venv')) { pkgs.push('python3-venv'); }
				if (!await isPackageInstalled(isWindows ? 'pip' : 'python3-pip')) { pkgs.push(isWindows ? 'pip' : 'python3-pip'); }
				if (pkgs.length > 0) {
					const terminal = vscode.window.createTerminal({ name: 'Install System Dependencies' });
					terminal.show();
					if (isWindows) {
						vscode.window.showWarningMessage(
							`Please install the following dependencies manually: ${pkgs.join(', ')}.\nVisit https://pygraphviz.github.io/documentation/stable/install.html#windows for Graphviz instructions.`
						);
					} else {
						terminal.sendText(`sudo apt update && sudo apt install -y ${pkgs.join(' ')}`);
						vscode.window.showWarningMessage(
							`Please complete the installation of system dependencies in the opened terminal, then retry.`
						);
					}
					return false;
				}
			} catch (e: any) {
				vscode.window.showWarningMessage(
					isWindows
						? "Failed to check/install system dependencies. Please install Python, pip, and Graphviz manually. See https://pygraphviz.github.io/documentation/stable/install.html#windows"
						: "Failed to check/install system dependencies. If you are using a debian-based environment, please run the following command in your terminal, then retry:\n" +
						  "sudo apt update && sudo apt install -y graphviz libgraphviz-dev python3-pip. Otherwise, please check https://pygraphviz.github.io/documentation/stable/install.html"
				);
				return false;
			}

			progress.report({ message: 'Creating Python virtual environment...' });
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
					await execPromise(`${isWindows ? 'python' : 'python3'} -m venv .venv`, { cwd: pythonDir });
				} catch (e: any) {
					vscode.window.showErrorMessage('Failed to create Python virtual environment: ' + (e.stderr || e.stdout || e.message || JSON.stringify(e)));
					return false;
				}
			}
			const venvActivate = isWindows
				? path.join(venvDir, 'Scripts', 'activate.bat')
				: path.join(venvDir, 'bin', 'activate');

			// Check if uv is installed
			const uvPath = isWindows
				? path.join(venvDir, 'Scripts', 'uv.exe')
				: path.join(venvDir, 'bin', 'uv');
			const uvInstalled = fs.existsSync(uvPath);
			if (!uvInstalled) {
				progress.report({ message: 'Installing uv in the virtual environment...' });
				try {
					if (isWindows) {
						await execPromise(`call "${venvActivate}" && pip install uv`, { cwd: pythonDir });
					} else {
						await execPromise(`. "${venvActivate}" && pip install uv`, { cwd: pythonDir });
					}
				} catch (e: any) {
					vscode.window.showErrorMessage('Failed to install uv in venv: ' + (e.stderr || e.stdout || e.message || JSON.stringify(e)));
					return false;
				}
			}

			progress.report({ message: 'Installing Python dependencies with uv sync...' });
			try {
				if (isWindows) {
					await execPromise(`call "${venvActivate}" && uv sync`, { cwd: pythonDir });
				} else {
					await execPromise(`. "${venvActivate}" && uv sync`, { cwd: pythonDir, shell: '/bin/bash' });
				}
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
		const venvActivate = path.join(pythonDir, '.venv', 'bin', 'activate');

		const blueprintTraceDir = path.join(folder, '.cache', 'blueprint_trace');
		if (!fs.existsSync(blueprintTraceDir)) {
			fs.mkdirSync(blueprintTraceDir);
		}
		const blueprintDataJsonl = path.join(blueprintTraceDir, 'blueprint_to_lean.jsonl');

		const outputChannel = vscode.window.createOutputChannel('Lean Blueprint Extraction');
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Parsing Blueprint project...' }, async () => {
			return new Promise<void>((resolve) => {
				outputChannel.clear();
				outputChannel.show(true);
				const child = require('child_process').spawn(
					'bash',
					['-c', `. "${venvActivate}" && lean-blueprint-extract-local --project-dir "${folder}"`],
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
					const treeNodes = loadBlueprintTreeFromJsonl(blueprintDataJsonl);
					if (treeNodes) {
						blueprintTreeProvider.refresh(treeNodes);
					}
					resolve();
				});
			});
		});
	});

	// Command to select a node for formalization
	const selectNodeForFormalizationDisposable = vscode.commands.registerCommand('leanblueprintcopilot.selectNodeForFormalization', async (blueprintData: any) => {
		if (!blueprintData) {
			vscode.window.showErrorMessage('No blueprint data provided for formalization.');
			return;
		}

		// Show information about the selected node
		const nodeInfo = `Selected node for formalization:
Label: ${blueprintData.label || 'N/A'}
Type: ${blueprintData.stmt_type || 'N/A'}
Text: ${blueprintData.processed_text || 'N/A'}`;

		const action = await vscode.window.showInformationMessage(
			nodeInfo,
			{ modal: true },
			'Start Formalization',
			'View Context'
		);

		if (action === 'Start Formalization') {
			// Open chat and provide context for formalization
			await vscode.commands.executeCommand('workbench.action.chat.open');

			// Prepare context for the AI
			const formalizationPrompt = `I need help formalizing this blueprint node in Lean:

**Label**: ${blueprintData.label || 'N/A'}
**Type**: ${blueprintData.stmt_type || 'N/A'}
**Statement**: ${blueprintData.processed_text || 'N/A'}

${blueprintData.proof ? `**Proof sketch**: ${blueprintData.proof.text || 'N/A'}` : ''}

Please help me formalize this ${blueprintData.stmt_type || 'statement'} in Lean. Consider the existing project structure and dependencies.`;

			// Copy the prompt to clipboard for easy pasting into chat
			await vscode.env.clipboard.writeText(formalizationPrompt);
			vscode.window.showInformationMessage('Formalization prompt copied to clipboard. Paste it in the chat to start!');
		} else if (action === 'View Context') {
			// Show detailed context in a new document
			const contextDoc = await vscode.workspace.openTextDocument({
				content: JSON.stringify(blueprintData, null, 2),
				language: 'json'
			});
			await vscode.window.showTextDocument(contextDoc);
		}
	});

	// Command for context menu formalization
	const formalizeNodeDisposable = vscode.commands.registerCommand('leanblueprintcopilot.formalizeNode', async (node: BlueprintNode) => {
		if (node && node.blueprintData) {
			await vscode.commands.executeCommand('leanblueprintcopilot.selectNodeForFormalization', node.blueprintData);
		} else {
			vscode.window.showErrorMessage('No blueprint data available for this node.');
		}
	});

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
				const venvActivate = path.join(pythonDir, '.venv', 'bin', 'activate');

				const port = '5000';

				let servers: vscode.McpServerDefinition[] = [];
				servers.push(new vscode.McpStdioServerDefinition(
					'Lean Blueprint Copilot',
					'bash',
					['-c', `. "${venvActivate}" && lean-blueprint-mcp --port ${port}`],
					{"LEAN_BLUEPRINT_PROJECT_DIR": folder},
				));
				return servers;
			});
		},
		resolveMcpServerDefinition: async (server: vscode.McpServerDefinition) => {return server;},
	});

	context.subscriptions.push(createBlueprintDisposable, parseBlueprintDisposable, selectNodeForFormalizationDisposable, formalizeNodeDisposable, registerMcpServerDisposable);

	// Command to show a QuickPick dropdown with checkboxes for filtering the tree by status
	const filterBlueprintTreeDisposable = vscode.commands.registerCommand('leanblueprintcopilot.filterBlueprintTree', async () => {
		const options = [
			{ label: 'Formalized', picked: blueprintTreeProvider['statusFilter'].has('formalized'), status: 'formalized' as BlueprintStatus },
			{ label: 'Non-formalized', picked: blueprintTreeProvider['statusFilter'].has('non-formalized'), status: 'non-formalized' as BlueprintStatus },
		];
		const selected = await vscode.window.showQuickPick(options, {
			canPickMany: true,
			placeHolder: 'Show nodes with status...'
		});
		if (selected && selected.length > 0) {
			const statuses = selected.map(s => s.status);
			blueprintTreeProvider.setStatusFilter(statuses);
		}
	});
	context.subscriptions.push(filterBlueprintTreeDisposable);

	// Command to filter the tree by search text using an input box
	let searchText: string = '';

	const searchBlueprintTreeDisposable = vscode.commands.registerCommand('leanblueprintcopilot.searchBlueprintTree', async () => {
		const input = await vscode.window.showInputBox({
			prompt: 'Search blueprint nodes by label or text',
			value: searchText
		});
		if (input !== undefined) {
			searchText = input;
			blueprintTreeProvider.setSearchText(searchText);
		}
	});
	context.subscriptions.push(searchBlueprintTreeDisposable);

	function buildTree(nodes: any[]): BlueprintNode[] {
		return nodes
			.filter((n) => n.label !== null)
			.map((n) => {
				const label = n.title || n.label || n.stmt_type || n.processed_text || 'Item';
				let children: BlueprintNode[] = [];
				// Add proof as a child if present
				if (n.proof) {
					children.push(...buildTree([n.proof]));
				}
				// Add children (recursively)
				if (n.children) {
					children.push(...buildTree(n.children));
				}
				// Add Lean declaration children (as leaf nodes)
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
				const node = new BlueprintNode(label, children, collapsibleState, n);
				const info = { ...n };
				delete info.children;
				delete info.proof;
				if (n.lean_names && Array.isArray(n.lean_names) && n.lean_names.length > 0) {
					node.description = `Lean: ${n.lean_names.join(', ')}`;
				}
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

	function loadBlueprintTreeFromJsonl(jsonlPath: string): BlueprintNode[] | undefined {
		if (!fs.existsSync(jsonlPath)) { return undefined; }
		try {
			const fileContent = fs.readFileSync(jsonlPath, 'utf8');
			const data = fileContent
				.split(/\r?\n/)
				.filter(line => line.trim().length > 0)
				.map(line => {
					try {
						return JSON.parse(line);
					} catch (e) {
						return null;
					}
				})
				.filter(obj => obj !== null);
			return buildTree(data);
		} catch (e) {
			vscode.window.showErrorMessage('Failed to parse `blueprint_to_lean.jsonl`');
			return undefined;
		}
	}

	// Try to load blueprint_to_lean.jsonl at startup
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceFolder) {
		const blueprintDir = require('path').join(workspaceFolder, 'blueprint');
		const blueprintDataJsonl = require('path').join(workspaceFolder, '.cache', 'blueprint_trace', 'blueprint_to_lean.jsonl');
		if (fs.existsSync(blueprintDir) && !fs.existsSync(blueprintDataJsonl)) {
			// Discrete, non-blocking info message to parse the project
			vscode.window.showInformationMessage(
				'Blueprint project detected. Parse the project to enable the tree view.',
				'Parse Now'
			).then((action) => {
				if (action === 'Parse Now') {
					vscode.commands.executeCommand('leanblueprintcopilot.parseBlueprintProject');
				}
			});
		}
		const treeNodes = loadBlueprintTreeFromJsonl(blueprintDataJsonl);
		if (treeNodes) {
			blueprintTreeProvider.refresh(treeNodes);
		}
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}

function getWorkspaceFolder(): string | undefined {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return undefined;
		}
		return folders[0].uri.fsPath;
	}
