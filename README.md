# Lean Blueprint Copilot

<div align="center">
  <img src="images/icon.png" alt="Lean Blueprint Copilot Icon" width="96"/>
</div>

![Experimental](https://img.shields.io/badge/status-experimental-orange)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/augustepoiroux.leanblueprintcopilot?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=augustepoiroux.leanblueprintcopilot)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/augustepoiroux.leanblueprintcopilot?label=Installs)](https://marketplace.visualstudio.com/items?itemName=augustepoiroux.leanblueprintcopilot)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/augustepoiroux.leanblueprintcopilot?label=Rating)](https://marketplace.visualstudio.com/items?itemName=augustepoiroux.leanblueprintcopilot)
[![License](https://img.shields.io/github/license/augustepoiroux/LeanBlueprintCopilot)](https://github.com/augustepoiroux/LeanBlueprintCopilot/blob/main/LICENSE)

This VS Code extension integrates Lean Blueprint with the Copilot agent mode, allowing LLMs to extract and utilize information from your Lean Blueprint projects and help you with Lean Blueprint development and formalization.

This package is still experimental and under development.
Please report any problems you encounter. Contributions are welcome too!

Compatible with all Lean versions between v4.8.0-rc1 and v4.22.0-rc3.

## Features

### Copilot Agent Mode

Once the extension is activated, Copilot agent mode will be able to automatically use tools providing access to extracted information about your Lean Blueprint project.

Tools are currently coming from the following MCP servers:

- [LeanBlueprintExtractor](https://github.com/augustepoiroux/LeanBlueprintExtractor)

Future versions may attempt to support the following MCP servers:

- [LeanExplore](https://www.leanexplore.com/docs/mcp)

Feel free to open an issue or a pull request if you want to add support for other MCP servers.

### Commands

- **Create Project**: Creates a new Lean Blueprint project in the current workspace.
- **Parse Project**: Parses the Lean Blueprint project in the current workspace and extracts information about the project. Necessary for the Copilot agent mode to work properly. Should be run again whenever the project is updated.
- **Build PDF**: Builds the PDF document from the Lean Blueprint project.
- **Build Web**: Builds the web documentation from the Lean Blueprint project.
- **Check Declarations**: Run the `checkdecls` command from the Lean Blueprint package. Official description: "check that every Lean declaration name that appear in the blueprint exist in the project (or in a dependency of the project such as Mathlib). This requires a compiled Lean project, so make sure to run lake build beforehand."
- **Build All**: Run "Build PDF", "Build Web", and "Check Declarations" commands in sequence.
- **Serve Web Blueprint**: Serve the web documentation from the Lean Blueprint project. This will start a local server that serves the web documentation, allowing you to view it inside VS Code.

## View panel

This extension adds a view panel of your Lean Blueprint statements in the primary sidebar. Formalized statements are displayed with a checkmark, while not-yet formalized statements are displayed with a yellow circle.

When clicking on a not-yet formalized statement, you will be prompted with a window to formalize it. Extracted information about the statement will be added to your clipboard, allowing you to paste it in the Copilot agent chat window. The Copilot agent will then be able to use this information to help you formalize the statement and extract more information using tools provided by this extension.

## Requirements

Requirements are the same as for [Lean Blueprint](https://github.com/PatrickMassot/leanblueprint). Please follow the [Lean Blueprint installation instructions](https://github.com/PatrickMassot/leanblueprint/tree/master?tab=readme-ov-file#installation).

## Known Issues

- Extraction is still very experimental and may face issues.
- When a few files are updated, the extracted data may be incorrect. We recommend removing the `.trace_cache` directory in your project folder to force a full extraction in this case.
- Web view in VS Code is sometimes buggy.
