import os
import subprocess
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from lean_interact import AutoLeanServer, Command, FileCommand, LeanREPLConfig, LocalProject
from lean_interact.interface import CommandResponse, LeanError

# from lean_project_extractor import trace_repo
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.fastmcp.prompts import base


@dataclass
class AppContext:
    repl_config: LeanREPLConfig
    repl_server: AutoLeanServer
    project_dir: str


@asynccontextmanager
async def app_lifespan(server: FastMCP) -> AsyncIterator[AppContext]:
    PROJECT_DIR = os.path.normpath(os.environ.get("LEAN_BLUEPRINT_PROJECT_DIR", ""))
    if not PROJECT_DIR:
        raise ValueError("Environment variable LEAN_BLUEPRINT_PROJECT_DIR is not set.")

    try:
        repl_config = LeanREPLConfig(project=LocalProject(directory=PROJECT_DIR))
        repl_server = AutoLeanServer(config=repl_config)
        yield AppContext(repl_config=repl_config, repl_server=repl_server, project_dir=PROJECT_DIR)
    finally:
        # Cleanup on shutdown
        pass


mcp = FastMCP(
    "LeanBlueprintCopilot",
    description="Lean Blueprint Copilot",
    dependencies=["lean-interact"],
    lifespan=app_lifespan,
    env_vars={
        "LEAN_BLUEPRINT_PROJECT_DIR": {
            "description": "Path to the Lean project directory",
            "required": True,
        }
    },
)


@mcp.tool()
async def build_project(ctx: Context) -> str:
    """Build the Lean project"""
    await ctx.info("Building the Lean project...")
    await ctx.report_progress(0, 1)
    try:
        subprocess.run(
            ["lake", "build"],
            cwd=ctx.request_context.lifespan_context.project_dir,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        await ctx.info("Build completed successfully.")
        return "Build completed successfully."
    except subprocess.CalledProcessError as e:
        ctx.error(f"Build failed: {e.stderr.decode().strip()}")
        return f"Build failed: {e.stderr.decode().strip()}"


@mcp.tool()
async def parse_project() -> None:
    """Parse the project"""


@mcp.tool()
async def type_check(ctx: Context, file: str, new_code: str) -> CommandResponse | LeanError:
    """Type checks the code in `new_code` by appending it at the end of the file `file`.
    Use this tool to efficiently verify your new code before writing it to the file."""
    ctx.info(f"Type checking `{repr(new_code)}` in {file}...")
    await ctx.report_progress(0, 1)
    try:
        lean_file = os.path.normpath(os.path.join(ctx.request_context.lifespan_context.project_dir, file))
        repl_server: LeanServer = ctx.request_context.lifespan_context.repl_server
        file_res = await repl_server.async_run(FileCommand(path=lean_file))
        if isinstance(file_res, LeanError):
            ctx.error(f"Provided file `{file}` could not be loaded: {file_res}")
            return file_res
        new_code_res = await repl_server.async_run(Command(cmd=new_code, env=file_res.env))
        return new_code_res
    except Exception as e:
        ctx.error(f"Type checking failed with unexpected error: {e}")
        raise e


@mcp.prompt()
def incorporate_latex_to_blueprint(raw_latex: str) -> list[base.Message]:
    """Incorporate raw Latex into Lean blueprint format using a LLM"""
    return [
        base.UserMessage("""You are an expert in Lean blueprints. Given the following raw LaTeX, structure it using the Lean blueprint format and incorporate the result in the blueprint. The Lean Blueprint format is characterized in particular by the following macros:
* `\\lean` that lists the Lean declaration names corresponding to the surrounding
    definition or statement (including namespaces).
* `\\leanok` which claims the surrounding environment is fully formalized. Here
    an environment could be either a definition/statement or a proof. You won't
    use this macro here as the content is not formalized yet.
* `\\uses` that lists LaTeX labels that are used in the surrounding environment.
    This information is used to create the dependency graph. Here
    an environment could be either a definition/statement or a proof, depending on
    whether the referenced labels are necessary to state the definition/theorem
    or only in the proof.

The example below show those essential macros in action, assuming the existence of
LaTeX labels `def:immersion`, `thm:open_ample` and `lem:open_ample_immersion` and
assuming the existence of a Lean declaration `sphere_eversion`.

```latex
\\begin{theorem}[Smale 1958]
    \\label{thm:sphere_eversion}
    \\lean{sphere_eversion}
    \\uses{def:immersion}
    There is a homotopy of immersions of $𝕊^2$ into $ℝ^3$ from the inclusion map to
    the antipodal map $a : q ↦ -q$.
\\end{theorem}

\\begin{proof}
    \\uses{thm:open_ample, lem:open_ample_immersion}
    This obviously follows from what we did so far.
\\end{proof}
```

Note that the proof above is abbreviated in this documentation.
Be nice to you and your collaborators and include more details in your blueprint proofs!"""),
        base.UserMessage(
            f"Here is the raw latex content you should incorporate into the blueprint of the project:\n```latex\n{raw_latex}\n```"
        ),
        base.UserMessage(
            """Transform the provided raw LaTeX into structured Lean blueprint LaTeX, and update the blueprint. The main content of your blueprint should live in `blueprint/src/content.tex` (or in files imported in `content.tex` if you want to split your content)."""
        ),
    ]


@mcp.tool()
async def formalize_statement(ctx: Context) -> str:
    """Formalize a statement in Lean"""
    ctx.info("Formalizing statement...")
    await ctx.report_progress(0, 1)
    "- \\leanok for formalized environments"


@mcp.tool()
async def formalize_proof(ctx: Context) -> str:
    """Formalize a proof in Lean.
    Use the `check_proofstep` tool to check the proof step by step."""
    ctx.info("Formalizing proof...")
    await ctx.report_progress(0, 1)
    "- \\leanok for formalized environments"


@mcp.tool()
async def check_proofstep(ctx: Context, proof_state: int, tactic: str) -> str:
    """Check a proof step, i.e. a tactic, in Lean"""
    ctx.info("Checking proof step...")
    await ctx.report_progress(0, 1)
    "- \\leanok for formalized environments"


@mcp.tool()
async def long_task(files: list[str], ctx: Context) -> str:
    """Process multiple files with progress tracking"""
    for i, file in enumerate(files):
        ctx.info(f"Processing {file}")
        await ctx.report_progress(i, len(files))
        data, mime_type = await ctx.read_resource(f"file://{file}")
    return "Processing complete"


if __name__ == "__main__":
    mcp.run()
