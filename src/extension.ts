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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
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
		const extractorScript = path.join(pythonDir, 'blueprint_extractor.py');
		const blueprintSrc = `${folder}/blueprint/src`;

		if (!fs.existsSync(extractorScript)) {
			vscode.window.showErrorMessage('blueprint_extractor.py not found in workspace. Please add the extraction script.');
			return;
		}

		const hiddenDir = path.join(folder, '.leanblueprintcopilot');
		if (!fs.existsSync(hiddenDir)) {
			fs.mkdirSync(hiddenDir);
		}
		const tmpJsonPath = path.join(hiddenDir, 'blueprint_tree.json');

		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Parsing Lean blueprint with plasTeX...' }, async () => {
			return new Promise<void>((resolve) => {
				exec(`bash -c '. "${venvActivate}" && python "${extractorScript}" "${blueprintSrc}" "${tmpJsonPath}"'`, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
					if (err) {
						vscode.window.showErrorMessage('Error running blueprint_extractor.py: ' + stderr);
						resolve();
						return;
					}
					try {
						const fileContent = fs.readFileSync(tmpJsonPath, 'utf8');
						const data = JSON.parse(fileContent);
						const treeData = Array.isArray(data) ? data : (data.tree || []);
						function buildTree(nodes: any[]): BlueprintNode[] {
							return nodes.map((n) => {
								const label = n.title || n.label || n.stmt_type || n.processed_text || 'Item';
								const children: BlueprintNode[] = [];
								if (n.proof) {
									children.push(...buildTree([n.proof]));
								}
								if (n.children) {
									children.push(...buildTree(n.children));
								}
								const node = new BlueprintNode(label, children);
								const info = { ...n };
								delete info.children;
								delete info.proof;
								if (info.lean || info.lean_urls) {
									const leanDecls = info.lean || [];
									const urls = info.lean_urls || [];
									if (leanDecls.length > 0) {
										node.description = `Lean: ${leanDecls.join(', ')}`;
									}
									if (urls.length > 0) {
										node.command = {
											command: 'vscode.open',
											title: 'Open Lean Declaration',
											arguments: [vscode.Uri.parse(urls[0])]
										};
									}
								}
								node.tooltip = JSON.stringify(info, null, 2);
								return node;
							});
						}
						const root = new BlueprintNode('Blueprint', buildTree(treeData));
						blueprintTreeProvider.refresh([root]);
						vscode.window.showInformationMessage('Blueprint structure loaded from plasTeX extraction.');
					} catch (e) {
						vscode.window.showErrorMessage('Failed to parse blueprint_extractor.py output as JSON.');
					}
					resolve();
				});
			});
		});
	});

	const incorporateLatexDisposable = vscode.commands.registerCommand('leanblueprintcopilot.incorporateLatex', async () => {
		const latexInput = await vscode.window.showInputBox({
			prompt: 'Paste raw LaTeX to incorporate into the blueprint',
			placeHolder: 'Paste your LaTeX here...'
		});
		if (!latexInput) {
			return;
		}

		const promptMessages = [
			vscode.LanguageModelChatMessage.User(`You are an expert in Lean blueprints. Given the following raw LaTeX, structure it as a Lean blueprint section, using the macros:
- \\lean for Lean declaration names
- \\leanok for formalized environments
- \\uses for dependencies

Example:

\\begin{theorem}[Smale 1958]
  \\label{thm:sphere_eversion}
  \\lean{sphere_eversion}
  \\leanok
  \\uses{def:immersion}
  There is a homotopy of immersions of $𝕊^2$ into $ℝ^3$ from the inclusion map to the antipodal map $a : q ↦ -q$.
\\end{theorem}

\\begin{proof}
  \\leanok
  \\uses{thm:open_ample, lem:open_ample_immersion}
  This obviously follows from what we did so far.
\\end

---

Raw LaTeX:
${latexInput}

---

Return only the structured Lean blueprint LaTeX, nothing else.`)
		];

		let result = '';
		try {
			const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
			if (!model) {
				vscode.window.showErrorMessage('No language model available. Please check your Copilot or language model setup.');
				return;
			}
			const chatResponse = await model.sendRequest(promptMessages, {}, new vscode.CancellationTokenSource().token);
			for await (const fragment of chatResponse.text) {
				result += fragment;
			}
		} catch (err) {
			if (err instanceof vscode.LanguageModelError) {
				vscode.window.showErrorMessage(`Language model error: ${err.message}`);
				return;
			} else {
				vscode.window.showErrorMessage('Error calling language model: ' + err);
				return;
			}
		}

		const doc = await vscode.workspace.openTextDocument({ content: result, language: 'latex' });
		await vscode.window.showTextDocument(doc, { preview: false });
	});
	context.subscriptions.push(incorporateLatexDisposable);

	context.subscriptions.push(createBlueprintDisposable, parseBlueprintDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}


// The main content of your blueprint should live in `content.tex` (or in files
// imported in `content.tex` if you want to split your content).

// The main TeX macros that relate your TeX code to your Lean code are:

// * `\lean` that lists the Lean declaration names corresponding to the surrounding
// 	definition or statement (including namespaces).
// * `\leanok` which claims the surrounding environment is fully formalized. Here
// 	an environment could be either a definition/statement or a proof.
// * `\uses` that lists LaTeX labels that are used in the surrounding environment.
// 	This information is used to create the dependency graph. Here
// 	an environment could be either a definition/statement or a proof, depending on
// 	whether the referenced labels are necessary to state the definition/theorem
// 	or only in the proof.

// The example below show those essential macros in action, assuming the existence of
// LaTeX labels `def:immersion`, `thm:open_ample` and `lem:open_ample_immersion` and
// assuming the existence of a Lean declaration `sphere_eversion`.

// ```latex
// \begin{theorem}[Smale 1958]
// 	\label{thm:sphere_eversion}
// 	\lean{sphere_eversion}
// 	\leanok
// 	\uses{def:immersion}
// 	There is a homotopy of immersions of $𝕊^2$ into $ℝ^3$ from the inclusion map to
// 	the antipodal map $a : q ↦ -q$.
// \end{theorem}

// \begin{proof}
// 	\leanok
// 	\uses{thm:open_ample, lem:open_ample_immersion}
// 	This obviously follows from what we did so far.
// \end
// ```

// Note that the proof above is abbreviated in this documentation.
// Be nice to you and your collaborators and include more details in your blueprint proofs!
